export interface Greeter {
  greet(name: string): string
}

export function createGreeter(): Greeter {
  return {
    greet: (name) => `Hello, ${name}`,
  }
}
