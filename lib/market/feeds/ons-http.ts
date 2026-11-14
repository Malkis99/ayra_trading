import { get as getHttps } from "node:https";
import { get as getHttp } from "node:http";
import type { Fetcher } from "./collect";

// A fresh HTTPS connection avoids implicit replay of a GET on a reused socket.
export const fetchOnsOnce = onsTransport("https://www.ons.gov.uk");

export function onsTransport(origin: string): Fetcher {
  const get = origin.startsWith("https:") ? getHttps : getHttp;
  return (url, init) => new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.origin !== origin) {
      reject(new Error("ONS GDP: unexpected request origin"));
      return;
    }
    const request = get(target, { agent: false, headers: init?.headers, signal: init?.signal }, response => {
      const status = response.statusCode ?? 0;
      const ok = status >= 200 && status < 300;
      if (!ok) response.destroy();
      resolve({
        status, ok,
        headers: { get: name => {
          const value = response.headers[name.toLowerCase()];
          return typeof value === "string" ? value : null;
        } },
        async text() {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of response) {
            length += chunk.length;
            if (length > 8 * 1024 * 1024) throw new Error("ONS GDP: response exceeds size limit");
            chunks.push(chunk);
          }
          return Buffer.concat(chunks).toString("utf8");
        },
      });
    });
    request.on("error", reject);
  });
}
