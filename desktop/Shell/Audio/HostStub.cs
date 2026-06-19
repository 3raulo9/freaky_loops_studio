using Jacobi.Vst.Core;
using Jacobi.Vst.Core.Host;

namespace FreakyLoops.Shell.Audio;

// The host-callback surface a VST2 plugin can call back into. Sane defaults;
// this phase doesn't expose automation, file dialogs, or transport/time info.
// Shape mirrors the canonical VST.NET2 host sample (DummyHostCommandStub).
internal sealed class HostStub : IVstHostCommandStub
{
    public HostStub() { Commands = new Commands20(); }

    public IVstPluginContext PluginContext { get; set; } = null!;
    public IVstHostCommands20 Commands { get; }

    private sealed class Commands20 : IVstHostCommands20
    {
        // IVstHostCommands20
        public bool BeginEdit(int index) => false;
        public VstCanDoResult CanDo(string cando) => VstCanDoResult.Unknown;
        public bool CloseFileSelector(VstFileSelect fileSelect) => false;
        public bool EndEdit(int index) => false;
        public VstAutomationStates GetAutomationState() => VstAutomationStates.Off;
        public int GetBlockSize() => 512;
        public string GetDirectory() => null!;
        public int GetInputLatency() => 0;
        public VstHostLanguage GetLanguage() => VstHostLanguage.NotSupported;
        public int GetOutputLatency() => 0;
        public VstProcessLevels GetProcessLevel() => VstProcessLevels.Unknown;
        public string GetProductString() => "Freaky Loops Studio";
        public float GetSampleRate() => 44100f;
        public VstTimeInfo GetTimeInfo(VstTimeInfoFlags filterFlags) => null!;
        public string GetVendorString() => "Freaky Loops";
        public int GetVendorVersion() => 1;
        public bool IoChanged() => false;
        public bool OpenFileSelector(VstFileSelect fileSelect) => false;
        public bool ProcessEvents(VstEvent[] events) => false;
        public bool SizeWindow(int width, int height) => false;
        public bool UpdateDisplay() => false;

        // IVstHostCommands10
        public int GetCurrentPluginID() => 0;
        public int GetVersion() => 2400;
        public void ProcessIdle() { }
        public void SetParameterAutomated(int index, float value) { }
    }
}
