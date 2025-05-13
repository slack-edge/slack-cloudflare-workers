import { SlackAPIResponse } from "slack-web-api-client";

export type SerializableSlackAPIResponse<T extends SlackAPIResponse> = Omit<T, "headers"> & {
  headers: Record<string, string>;
};

/**
 * Converts a SlackAPIResponse to a SerializableSlackAPIResponse.
 * Serializes the headers value.
 * @param response - The SlackAPIResponse to convert
 * @returns The converted SerializableSlackAPIResponse
 */
export function toSerializableSlackAPIResponse<T extends SlackAPIResponse>(response: T): SerializableSlackAPIResponse<T> {
  // Replace the Headers entries with a serializable object
  const { headers, ...rest } = response;
  return {
    ...rest,
    headers: Object.fromEntries(headers.entries()),
  };
}

/**
 * Converts a SerializableSlackAPIResponse to a SlackAPIResponse.
 * Deserializes the headers value.
 * @param response - The SerializableSlackAPIResponse to convert
 * @returns The converted SlackAPIResponse
 */
export function fromSerializableSlackAPIResponse<T extends SlackAPIResponse>(response: SerializableSlackAPIResponse<T>): SlackAPIResponse {
  // Reconstruct the Headers object
  const headers = new Headers(response.headers);

  // Rebuild the original object with Headers restored
  const { headers: serializedHeaders, ...rest } = response;
  return {
    ...rest,
    headers,
  };
}
