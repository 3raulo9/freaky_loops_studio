using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace FreakyLoops.Shell.Audio;

// Phase 0b: minimal proof that C# can drive the audio device and make sound.
// Uses WaveOutEvent (WinMM) because it's format-flexible and zero-config, so we
// don't trip on WASAPI shared-mode format matching this early. Low-latency
// ASIO/WASAPI output arrives with the real engine in Phase 1.
public sealed class AudioEngine : IDisposable
{
    private WaveOutEvent? _out;
    private readonly object _gate = new();

    /// <summary>Start a continuous sine tone. Replaces any tone already playing.</summary>
    public void StartTone(double freqHz = 440, double gain = 0.2)
    {
        lock (_gate)
        {
            StopInternal();

            var gen = new SignalGenerator(44100, 2)
            {
                Gain = gain,
                Frequency = freqHz,
                Type = SignalGeneratorType.Sin,
            };

            _out = new WaveOutEvent { DesiredLatency = 120 };
            _out.Init(new SampleToWaveProvider16(gen));
            _out.Play();
        }
    }

    public void StopTone()
    {
        lock (_gate) { StopInternal(); }
    }

    private void StopInternal()
    {
        _out?.Stop();
        _out?.Dispose();
        _out = null;
    }

    public void Dispose()
    {
        lock (_gate) { StopInternal(); }
    }
}
