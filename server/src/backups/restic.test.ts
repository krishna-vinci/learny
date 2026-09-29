import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type BackupDestination, parseDestination } from "./config.js";
import { buildResticEnv, isMissingRepository, parseSnapshotId, redactSecrets, repositoryString } from "./restic.js";

const dataDir = "/srv/studium/data";

afterEach(() => {
  delete process.env.AWS_PROFILE;
  delete process.env.RESTIC_KEY_HINT;
  delete process.env.STUDIUM_SECRET;
});

describe("restic environment", () => {
  it("passes only the allow-listed variables to restic", () => {
    process.env.AWS_PROFILE = "leak-me";
    process.env.RESTIC_KEY_HINT = "leak-me";
    process.env.STUDIUM_SECRET = "leak-me";

    const local = parseDestination({ type: "local", path: "/srv/repo" });
    const env = buildResticEnv(local, "repo-password", dataDir);
    expect(new Set(Object.keys(env))).toEqual(new Set(["PATH", "HOME", "RESTIC_PASSWORD", "RESTIC_REPOSITORY"]));
    expect(Object.values(env)).not.toContain("leak-me");
    expect(env.HOME).toBe(path.join(dataDir, ".backup", "home"));
  });

  it("adds the destination-specific variables", () => {
    const s3 = parseDestination({
      type: "s3",
      endpoint: "https://s3.example.com",
      bucket: "studium",
      prefix: "daily",
      accessKeyId: "AKIA",
      secretAccessKey: "shh",
      region: "us-east-1",
    });
    expect(buildResticEnv(s3, "pw", dataDir)).toMatchObject({
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "shh",
      AWS_DEFAULT_REGION: "us-east-1",
    });

    const rest = parseDestination({
      type: "rest",
      url: "https://rest.example.com/",
      username: "backup",
      password: "shh",
    });
    expect(buildResticEnv(rest, "pw", dataDir)).toMatchObject({
      RESTIC_REST_USERNAME: "backup",
      RESTIC_REST_PASSWORD: "shh",
    });

    const rclone = parseDestination({
      type: "rclone",
      remote: "b2",
      path: "studium",
      rcloneConfig: "[b2]\ntype = b2\n",
    });
    expect(buildResticEnv(rclone, "pw", dataDir).RCLONE_CONFIG).toBe(path.join(dataDir, ".backup", "rclone.conf"));
  });

  it("builds the documented repository strings", () => {
    const cases: Array<[BackupDestination, string]> = [
      [{ type: "local", path: "/srv/repo" }, "/srv/repo"],
      [{ type: "sftp", host: "host", port: 22, user: "backup", path: "/srv/repo" }, "sftp:backup@host:/srv/repo"],
      [{ type: "rest", url: "https://rest.example.com/" }, "https://rest.example.com/"],
      [
        {
          type: "s3",
          endpoint: "https://s3.example.com/",
          bucket: "studium",
          prefix: "/daily/",
          accessKeyId: "a",
          secretAccessKey: "b",
        },
        "s3:https://s3.example.com/studium/daily",
      ],
      [{ type: "rclone", remote: "b2", path: "studium", rcloneConfig: "[b2]" }, "rclone:b2:studium"],
    ];
    for (const [destination, expected] of cases) {
      expect(repositoryString(destination)).toBe(expected);
    }
  });
});

describe("restic output helpers", () => {
  it("redacts secrets, including URL-encoded copies", () => {
    const password = "p@ss word/extra";
    const text = `failed with ${password} and ${encodeURIComponent(password)}`;
    const redacted = redactSecrets(text, [password]);
    expect(redacted).not.toContain(password);
    expect(redacted).not.toContain(encodeURIComponent(password));
    expect(redacted).toContain("***");
  });

  it("recognises a missing repository", () => {
    expect(
      isMissingRepository("Fatal: unable to open config file: stat /srv/repo/config: no such file or directory"),
    ).toBe(true);
    expect(isMissingRepository("Fatal: unable to open config file: The specified key does not exist")).toBe(true);
    expect(isMissingRepository("Fatal: wrong password or no key found")).toBe(false);
  });

  it("parses the snapshot id from the backup summary", () => {
    const stdout = [
      '{"message_type":"status","percent_done":0.5}',
      '{"message_type":"summary","files_new":1,"snapshot_id":"abcdef0123456789"}',
    ].join("\n");
    expect(parseSnapshotId(stdout)).toBe("abcdef0123456789");
    expect(parseSnapshotId("")).toBeNull();
    expect(parseSnapshotId("not json")).toBeNull();
  });
});
