import assert from "node:assert/strict";
import test from "node:test";
import {
  enabledSkills,
  listInstalledSkills,
  skillEnabled,
 addManualSkill,
  skillsCatalogPrompt,
} from "../lib/skills";

test("installed skills come from the lockfile and default to enabled", () => {
  const skills = listInstalledSkills();
  assert.ok(skills.length >= 1);
  assert.ok(skills.every((skill) => skill.id && skill.skillPath));
  assert.equal(skillEnabled(skills[0].id), true);
  assert.equal(skillEnabled(skills[0].id, { enabledSkills: { [skills[0].id]: false } }), false);
});

test("disabled skills are omitted from the agent catalog", () => {
  const skills = listInstalledSkills();
  const disabled = Object.fromEntries(skills.map((skill) => [skill.id, false]));
  assert.equal(enabledSkills({ enabledSkills: disabled }).length, 0);
  assert.equal(skillsCatalogPrompt({ enabledSkills: disabled }), "");
  const catalog = skillsCatalogPrompt();
  assert.match(catalog, /Installed skills/);
  assert.ok(skills.some((skill) => catalog.includes(skill.id)));
});

test("manual skills reject unsafe ids", () => {
 assert.throws(() => addManualSkill("../outside", "# Skill"), /Skill id/);
});
