import { ANSIBLE_FACT_VARIABLES } from './ansibleFacts';

describe('ansibleFacts', () => {
  it('exposes a non-empty, uniquely-named list of {name, source, preview} facts', () => {
    expect(ANSIBLE_FACT_VARIABLES.length).toBeGreaterThan(10);
    const names = ANSIBLE_FACT_VARIABLES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    ANSIBLE_FACT_VARIABLES.forEach((f) => {
      expect(f.source).toBe('ansible fact');
      expect(f.preview).toEqual(expect.any(String));
      expect(f.preview.length).toBeGreaterThan(0);
    });
  });

  it('includes the common distribution/os_family/hostname facts as bare bracket expressions', () => {
    const names = ANSIBLE_FACT_VARIABLES.map((f) => f.name);
    expect(names).toContain("ansible_facts['distribution']");
    expect(names).toContain("ansible_facts['os_family']");
    expect(names).toContain("ansible_facts['hostname']");
    // No {{ }} wrapper — these plug directly into a cond_var block's NAME
    // field (which is emitted verbatim, see conditionParser.js/blocks.js).
    names.forEach((n) => {
      expect(n).not.toMatch(/[{}]/);
    });
  });
});
