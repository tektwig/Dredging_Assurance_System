export class LoadingAuthorizationError extends Error {
  constructor() { super('Loading access unavailable'); }
}

// A transport failure does not reveal whether the database committed the RPC.
export class RegistrationOutcomeUnknownError extends Error {
  constructor() { super('Registration outcome unknown'); }
}
