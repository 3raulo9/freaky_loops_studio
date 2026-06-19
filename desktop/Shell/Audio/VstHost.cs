using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Drawing;
using Jacobi.Vst.Core;
using Jacobi.Vst.Host.Interop;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace FreakyLoops.Shell.Audio;

// Hosts a single VST2 (.dll) instrument: loads it, drives it from MIDI note
// events, and streams its audio out via WaveOut. Smoke-test quality — one
// plugin at a time, immediate (non-sample-accurate) note timing.
public sealed class VstHost : IDisposable
{
    private const int SampleRate = 44100;
    private const int BlockSize = 512;

    private readonly object _gate = new();
    private readonly ConcurrentQueue<VstMidiEvent> _midi = new();
    private VstPluginContext? _ctx;
    private WaveOutEvent? _out;

    public string? PluginName { get; private set; }
    public int AudioInputCount { get; private set; }
    public int AudioOutputCount { get; private set; }
    public bool CanReplacing { get; private set; }
    public bool IsSynth { get; private set; }

    // Peak level of the last rendered block(s), for a UI/console meter.
    private volatile float _peak;
    internal void ReportPeak(float p) { if (p > _peak) _peak = p; }
    public float ReadPeakReset() { float p = _peak; _peak = 0f; return p; }

    // ── Editor (plugin GUI) ──────────────────────────────────────────────────
    public bool HasEditor => _ctx != null && (_ctx.PluginInfo.Flags & VstPluginFlags.HasEditor) != 0;

    public Rectangle GetEditorRect()
    {
        if (_ctx != null && _ctx.PluginCommandStub.Commands.EditorGetRect(out Rectangle r)
            && r.Width > 0 && r.Height > 0)
            return r;
        return new Rectangle(0, 0, 480, 320);
    }

    public void EditorOpen(IntPtr hwnd) => _ctx?.PluginCommandStub.Commands.EditorOpen(hwnd);
    public void EditorIdle() => _ctx?.PluginCommandStub.Commands.EditorIdle();
    public void EditorClose() => _ctx?.PluginCommandStub.Commands.EditorClose();

    /// <summary>Load a 64-bit VST2 .dll and start streaming its output. Returns the plugin name.</summary>
    public string Load(string path)
    {
        lock (_gate)
        {
            UnloadInternal();
            Log.Write($"Loading VST: {path}");

            var hostStub = new HostStub();
            VstPluginContext ctx = VstPluginContext.Create(path, hostStub);
            hostStub.PluginContext = ctx;

            var cmd = ctx.PluginCommandStub.Commands;
            cmd.Open();
            cmd.SetSampleRate(SampleRate);
            cmd.SetBlockSize(BlockSize);
            cmd.MainsChanged(true);
            cmd.StartProcess();

            _ctx = ctx;
            PluginName = SafeName(ctx);

            var info = ctx.PluginInfo;
            AudioInputCount = info.AudioInputCount;
            AudioOutputCount = info.AudioOutputCount;
            CanReplacing = (info.Flags & VstPluginFlags.CanReplacing) != 0;
            IsSynth = (info.Flags & VstPluginFlags.IsSynth) != 0;

            var provider = new VstSampleProvider(this, ctx, BlockSize);
            _out = new WaveOutEvent { DesiredLatency = 150 };
            _out.Init(new SampleToWaveProvider16(provider));
            _out.Play();

            Log.Write($"VST started: {PluginName} in={AudioInputCount} out={AudioOutputCount} " +
                      $"canReplacing={CanReplacing} isSynth={IsSynth}");
            return PluginName;
        }
    }

    public void NoteOn(int pitch, int velocity = 100)
    {
        Log.Write($"noteOn {pitch} v{velocity}");
        _midi.Enqueue(MakeNote(0x90, pitch, velocity));
    }

    public void NoteOff(int pitch)
    {
        Log.Write($"noteOff {pitch}");
        _midi.Enqueue(MakeNote(0x80, pitch, 0));
    }

    // Called from the audio thread once per block.
    internal VstEvent[] DrainMidi()
    {
        if (_midi.IsEmpty) return Array.Empty<VstEvent>();
        var list = new List<VstEvent>();
        while (_midi.TryDequeue(out VstMidiEvent? ev)) list.Add(ev);
        return list.ToArray();
    }

    private static VstMidiEvent MakeNote(int status, int pitch, int velocity)
    {
        var data = new byte[] { (byte)status, (byte)pitch, (byte)velocity, 0 };
        return new VstMidiEvent(0, 0, 0, data, 0, 0);
    }

    private static string SafeName(VstPluginContext ctx)
    {
        try { return ctx.PluginCommandStub.Commands.GetEffectName() ?? "VST"; }
        catch { return "VST"; }
    }

    private void UnloadInternal()
    {
        _out?.Stop();
        _out?.Dispose();
        _out = null;

        if (_ctx != null)
        {
            try { _ctx.PluginCommandStub.Commands.StopProcess(); } catch { /* best effort */ }
            try { _ctx.PluginCommandStub.Commands.MainsChanged(false); } catch { }
            try { _ctx.PluginCommandStub.Commands.Close(); } catch { }
            _ctx.Dispose();
            _ctx = null;
        }

        while (_midi.TryDequeue(out _)) { }
        PluginName = null;
    }

    public void Unload() { lock (_gate) UnloadInternal(); }
    public void Dispose() { lock (_gate) UnloadInternal(); }
}

// Pulls audio from the plugin a block at a time and feeds NAudio. Renders one
// fixed-size VST block, spills it into the interleaved stereo output, and tops
// up across Read() calls that don't align to the block size.
internal sealed class VstSampleProvider : ISampleProvider
{
    private readonly VstHost _host;
    private readonly VstPluginContext _ctx;
    private readonly int _blockSize;
    private readonly VstAudioBufferManager _inMgr;
    private readonly VstAudioBufferManager _outMgr;
    private readonly VstAudioBuffer[] _in;
    private readonly VstAudioBuffer[] _out;
    private readonly float[] _spill;
    private bool _loggedErr;
    private int _spillLen;
    private int _spillPos;

    public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(44100, 2);

    public VstSampleProvider(VstHost host, VstPluginContext ctx, int blockSize)
    {
        _host = host;
        _ctx = ctx;
        _blockSize = blockSize;

        int inCount = ctx.PluginInfo.AudioInputCount;
        int outCount = ctx.PluginInfo.AudioOutputCount;
        _inMgr = new VstAudioBufferManager(inCount, blockSize);
        _outMgr = new VstAudioBufferManager(outCount, blockSize);
        _in = _inMgr.Buffers.ToArray();
        _out = _outMgr.Buffers.ToArray();
        _spill = new float[blockSize * 2];
        _spillPos = _spillLen; // start empty so the first Read renders a block
    }

    public int Read(float[] buffer, int offset, int count)
    {
        int written = 0;
        while (written < count)
        {
            if (_spillPos >= _spillLen) RenderBlock();
            int n = Math.Min(count - written, _spillLen - _spillPos);
            Array.Copy(_spill, _spillPos, buffer, offset + written, n);
            _spillPos += n;
            written += n;
        }
        return count;
    }

    private void RenderBlock()
    {
        VstEvent[] events = _host.DrainMidi();
        var cmd = _ctx.PluginCommandStub.Commands;
        if (events.Length > 0)
        {
            Log.Write($"ProcessEvents x{events.Length}");
            cmd.ProcessEvents(events);
        }

        try { cmd.ProcessReplacing(_in, _out); }
        catch (Exception ex)
        {
            if (!_loggedErr) { _loggedErr = true; Log.Write("ProcessReplacing threw: " + ex); }
        }

        float peak = 0f;
        if (_out.Length >= 2)
        {
            VstAudioBuffer l = _out[0], r = _out[1];
            for (int i = 0; i < _blockSize; i++)
            {
                float ls = l[i], rs = r[i];
                _spill[i * 2] = ls;
                _spill[i * 2 + 1] = rs;
                float a = Math.Max(Math.Abs(ls), Math.Abs(rs));
                if (a > peak) peak = a;
            }
        }
        else if (_out.Length == 1)
        {
            VstAudioBuffer m = _out[0];
            for (int i = 0; i < _blockSize; i++)
            {
                float s = m[i];
                _spill[i * 2] = s;
                _spill[i * 2 + 1] = s;
                float a = Math.Abs(s);
                if (a > peak) peak = a;
            }
        }
        else
        {
            Array.Clear(_spill, 0, _spill.Length);
        }

        _host.ReportPeak(peak);
        _spillLen = _blockSize * 2;
        _spillPos = 0;
    }
}
