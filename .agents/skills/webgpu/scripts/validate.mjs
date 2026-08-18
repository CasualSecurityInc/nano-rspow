import { access, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const skillPath = resolve(skillDir, "SKILL.md");
const skill = await readFile(skillPath, "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

if (!frontmatter) {
  errors.push("SKILL.md must start with YAML frontmatter");
} else {
  const keys = frontmatter[1]
    .split("\n")
    .filter((line) => /^[a-z][a-z0-9_-]*:/.test(line))
    .map((line) => line.slice(0, line.indexOf(":")));
  if (keys.join(",") !== "name,description") {
    errors.push("SKILL.md frontmatter must contain only name and description");
  }
  if (!/^name: webgpu$/m.test(frontmatter[1])) {
    errors.push("Skill name must be webgpu");
  }
}

const required = [
  "SKILL.md",
  "agents/openai.yaml",
  "agents/claude.md",
  "assets/starter/index.html",
  "assets/starter/package.json",
  "assets/starter/src/gpu.ts",
  "assets/starter/src/main.ts",
  "assets/starter/src/shaders.ts",
  "references/current-sources.md",
];

for (const path of required) {
  if (!(await exists(resolve(skillDir, path)))) {
    errors.push(`Missing required file: ${path}`);
  }
}

const files = await walk(skillDir);
const markdownFiles = files.filter((path) => path.endsWith(".md"));
let localLinkCount = 0;

for (const path of markdownFiles) {
  const markdown = await readFile(path, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) continue;
    const target = raw.split("#", 1)[0];
    if (!target) continue;
    localLinkCount++;
    if (!(await exists(resolve(dirname(path), target)))) {
      errors.push(
        `Broken local link in ${relative(skillDir, path)}: ${raw}`
      );
    }
  }
}

for (const path of files.filter((value) => value.endsWith(".ts"))) {
  const source = await readFile(path, "utf8");
  if (source.includes("@ts-nocheck")) {
    errors.push(`Do not hide type errors in ${relative(skillDir, path)}`);
  }
}

const allMarkdown = (
  await Promise.all(markdownFiles.map((path) => readFile(path, "utf8")))
).join("\n");
if (/all (?:WGSL )?structs (?:are|should be) aligned to 16 bytes/i.test(allMarkdown)) {
  errors.push("WGSL layout guidance must not claim every struct is 16-byte aligned");
}
if (/\bnpx\s+skills\s+add\b/i.test(allMarkdown)) {
  errors.push(
    "Keep executable third-party install commands out of the distributed skill"
  );
}

const openai = await readFile(resolve(skillDir, "agents/openai.yaml"), "utf8");
if (!openai.includes("$webgpu")) {
  errors.push("agents/openai.yaml default_prompt must mention $webgpu");
}

const starterSources = await Promise.all(
  ["src/gpu.ts", "src/main.ts", "src/shaders.ts"].map((path) =>
    readFile(resolve(skillDir, "assets/starter", path), "utf8")
  )
);
const starter = starterSources.join("\n");
if (/\bfetch\s*\(/.test(starter)) {
  errors.push(
    "The bundled starter must not fetch runtime code or other network dependencies"
  );
}
for (const hook of [
  "navigator.gpu",
  "getCompilationInfo",
  "uncapturederror",
  "device.lost",
  "ResizeObserver",
  "destroy()",
]) {
  if (!starter.includes(hook)) {
    errors.push(`Starter is missing resilience hook: ${hook}`);
  }
}

if (errors.length > 0) {
  throw new Error(errors.map((error) => `- ${error}`).join("\n"));
}

console.log(
  `Validated WebGPU skill (${markdownFiles.length} Markdown files, ${localLinkCount} local links)`
);
