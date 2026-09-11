export class RelayError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = "RelayError"
    this.code = code
  }
}
