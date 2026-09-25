export class LoadingAuthorizationError extends Error {
  constructor() { super('Loading access unavailable'); }
}

// A transport failure does not reveal whether the database committed the RPC.
export class RegistrationOutcomeUnknownError extends Error {
  constructor() { super('Registration outcome unknown'); }
}

// The opening RPC may have committed before a transport or response failure.
export class TripOutcomeUnknownError extends Error {
  constructor() { super('Trip opening outcome unknown'); }
}
