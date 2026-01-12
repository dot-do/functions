// AssemblyScript entry point for Cloudflare Workers

@external("env", "response_new")
declare function response_new(bodyPtr: usize, bodyLen: u32, status: u32): u32;

@external("env", "response_body_write")
declare function response_body_write(ptr: usize, len: u32): void;

// Export the fetch handler for Cloudflare Workers
export function fetch(): u32 {
  const message = "Hello World!";
  const encoded = String.UTF8.encode(message);
  return response_new(changetype<usize>(encoded), encoded.byteLength, 200);
}

// Memory management exports required by AssemblyScript
export const memory = memory;
