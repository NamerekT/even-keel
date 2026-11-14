import { describe, expect, it } from "vitest";
import { addressRefusal, reachesService } from "./addressban.mjs";

const URL = "http://127.0.0.1:4747";

describe("reachesService", () => {
  it("knows a request to the service's address by any loopback name, by any network tool", () => {
    for (const command of [
      "curl http://127.0.0.1:4747/api/state",
      "curl -s -X POST localhost:4747/api/chain/start",
      "wget -qO- http://localhost:4747/api/state",
      "Invoke-WebRequest -Uri http://127.0.0.1:4747/api/state",
      "iwr http://127.0.0.1:4747/api/state -Method Post",
      "Invoke-RestMethod http://[::1]:4747/api/state",
      "irm http://0.0.0.0:4747/api/state",
      "curl http://127.0.0.2:4747/api/state",
      "CURL.EXE http://127.0.0.1:4747/",
      "/usr/bin/curl http://127.0.0.1:4747/",
      'node -e "fetch(\'http://127.0.0.1:4747/api/state\')"',
      "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:4747/')\"",
      "(New-Object Net.WebClient).DownloadString('http://127.0.0.1:4747/api/state')",
      "cd x && curl http://127.0.0.1:4747/api/state",
      'bash -c "curl http://127.0.0.1:4747/api/state"',
      "curl $EVEN_KEEL_URL/api/state",
      'curl "${EVEN_KEEL_URL}/api/state"',
      "irm $env:EVEN_KEEL_URL/api/state",
      "curl %EVEN_KEEL_URL%/api/state",
    ]) {
      expect(reachesService(command, URL), command).toBe(true);
    }
  });

  it("knows the address the service is reached at when it is not a loopback one", () => {
    expect(reachesService("curl http://192.168.1.5:5000/api/state", "http://192.168.1.5:5000")).toBe(true);
    expect(reachesService("curl http://192.168.1.5:5000/api/state", URL)).toBe(false);
  });

  it("lets through a command that only names the address and a request elsewhere", () => {
    for (const command of [
      'grep -rn "127.0.0.1:4747" docs',
      "cat docs/service.md",
      "echo http://127.0.0.1:4747",
      "curl http://127.0.0.1:47470/",
      "curl http://127.0.0.1:5173/",
      "curl https://example.com/4747",
      "curl http://localhost:14747/",
      "npm test",
      "",
    ]) {
      expect(reachesService(command, URL), command).toBe(false);
    }
    expect(reachesService(undefined, URL)).toBe(false);
  });

  it("takes the default address when Even Keel names none", () => {
    expect(reachesService("curl http://localhost:4747/", undefined)).toBe(true);
    expect(reachesService("curl http://localhost:4747/", "not a url")).toBe(true);
  });
});

describe("addressRefusal", () => {
  it("refuses a request to the service when the project's group is on, asking Even Keel only then", async () => {
    const asked = [];
    const checkOf = (answer) => () => {
      asked.push(answer);
      return answer;
    };
    expect(await addressRefusal("curl http://127.0.0.1:4747/api/state", checkOf({ ownAddress: true }), URL)).toMatch(/Even Keel's own address/);
    expect(await addressRefusal("curl http://127.0.0.1:4747/api/state", checkOf({}), URL)).toBeNull();
    expect(await addressRefusal("npm test", checkOf({ ownAddress: true }), URL)).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("leaves the call to the agent when Even Keel does not answer", async () => {
    const failing = () => Promise.reject(new Error("down"));
    expect(await addressRefusal("curl http://127.0.0.1:4747/", failing, URL)).toBeNull();
  });
});
