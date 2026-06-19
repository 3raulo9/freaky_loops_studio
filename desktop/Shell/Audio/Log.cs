using System;
using System.IO;

namespace FreakyLoops.Shell.Audio;

// Dead-simple append-only file logger for debugging the native audio/VST path.
// Writes to %TEMP%\freakyloops.log. Logging must never throw.
internal static class Log
{
    private static readonly string FilePath =
        Path.Combine(Path.GetTempPath(), "freakyloops.log");
    private static readonly object Gate = new();

    public static void Write(string msg)
    {
        try
        {
            lock (Gate)
                File.AppendAllText(FilePath, $"{DateTime.Now:HH:mm:ss.fff}  {msg}{Environment.NewLine}");
        }
        catch { /* ignore */ }
    }
}
