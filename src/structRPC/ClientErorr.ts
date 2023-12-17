export class ClientError extends Error {
    public readonly _isClientError = true
    public readonly name = "ClientError"
}
