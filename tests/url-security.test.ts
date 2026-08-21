import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicHttpUrl,
  fetchWithValidatedRedirects,
  isPrivateAddress,
  readResponseTextBounded,
} from "../lib/url-security";

test("URL policy blocks private, link-local, CGNAT, multicast, and mapped IPv4 addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
});

test("URL policy validates every resolved address", async () => {
  await assert.rejects(
    assertPublicHttpUrl("https://public.example", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
    }),
    /private/i,
  );
  await assert.rejects(
    assertPublicHttpUrl("http://localhost:8080"),
    /private/i,
  );
});

test("bounded response reader does not consume beyond its limit", async () => {
  const response = new Response("0123456789");
  assert.equal(await readResponseTextBounded(response, 4), "0123");
});

test("redirect validation checks every hop before following it", async () => {
  const calls: string[] = [];
  const lookup = async (hostname: string) => {
    if (hostname === "public.example") return [{ address: "93.184.216.34", family: 4 }];
    throw new Error("private DNS result");
  };
  await assert.rejects(
    fetchWithValidatedRedirects("https://public.example/start", {
      headers: { "x-test": "1" },
    }, {
      lookup,
      fetcher: async (url) => {
        calls.push(url.toString());
        return new Response(null, { status: 302, headers: { location: "http://internal.example/" } });
      },
    }),
    /private DNS result/i,
  );
  assert.deepEqual(calls, ["https://public.example/start"]);
});

test("redirect validation permits bounded public redirect chains", async () => {
  const calls: string[] = [];
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await fetchWithValidatedRedirects("https://public.example/start", {}, {
    lookup,
    fetcher: async (url) => {
      calls.push(url.toString());
      return calls.length === 1
        ? new Response(null, { status: 302, headers: { location: "/final" } })
        : new Response("ok", { status: 200 });
    },
  });
  assert.equal(await result.response.text(), "ok");
  assert.deepEqual(calls, ["https://public.example/start", "https://public.example/final"]);
});
