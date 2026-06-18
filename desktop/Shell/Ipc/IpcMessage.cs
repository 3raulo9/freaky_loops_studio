using System.Text.Json.Serialization;

namespace FreakyLoops.Shell.Ipc;

// Wire format for every control message between the Vue UI and the C# host.
// `Payload` stays loose for now so new message types don't each need a class;
// it gets tightened into typed records as the protocol firms up.
public sealed record IpcMessage(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("payload")] object? Payload = null);
