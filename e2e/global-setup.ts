import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

export default async function globalSetup() {
  if (!existsSync(join(root, "e2e/.library"))) run("node", ["e2e/fixtures/make-library.ts"]);
  mkdirSync(join(root, "e2e/.navidrome"), { recursive: true });
  run("docker", ["compose", "-f", "e2e/compose.yml", "up", "-d", "--wait"]);
  const q = "u=admin&p=needle-test&c=e2e&v=1.16.1&f=json";
  await fetch(`http://127.0.0.1:14533/rest/startScan.view?${q}&fullScan=true`);
  for (let i = 0; i < 60; i++) {
    const r = (await (await fetch(`http://127.0.0.1:14533/rest/getScanStatus.view?${q}`)).json()) as { "subsonic-response": { scanStatus: { scanning: boolean; count: number } } };
    const s = r["subsonic-response"].scanStatus;
    if (!s.scanning && s.count > 0) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  run("node", ["--disable-warning=ExperimentalWarning", "e2e/fixtures/seed.ts"], { NEEDLE_DATA_DIR: join(root, "e2e/.data") });
}
