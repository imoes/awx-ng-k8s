import { ANSIBLE_FACT_VARIABLES, ANSIBLE_MAGIC_VARIABLES } from './ansibleFacts';

describe('ansibleFacts', () => {
  it('exposes a large, uniquely-named list of {name, source, preview} facts (cross-checked against docs.ansible.com)', () => {
    // Full sweep of playbooks_vars_facts.html's documented fact groups —
    // system/hardware/memory/network/storage/date-time/user/security/
    // software/virtualization/custom facts — not just a handful.
    expect(ANSIBLE_FACT_VARIABLES.length).toBeGreaterThan(40);
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

  it('covers hardware, memory, network, date/time, user, security, and virtualization fact groups', () => {
    const names = ANSIBLE_FACT_VARIABLES.map((f) => f.name);
    expect(names).toContain("ansible_facts['processor_vcpus']");
    expect(names).toContain("ansible_facts['memtotal_mb']");
    expect(names).toContain("ansible_facts['default_ipv4']['address']");
    expect(names).toContain("ansible_facts['mounts']");
    expect(names).toContain("ansible_facts['date_time']['iso8601']");
    expect(names).toContain("ansible_facts['user_id']");
    expect(names).toContain("ansible_facts['selinux']['status']");
    expect(names).toContain("ansible_facts['virtualization_type']");
    expect(names).toContain('ansible_local');
  });

  it('exposes magic variables (non-facts, e.g. inventory_hostname/group_names/hostvars) separately tagged', () => {
    expect(ANSIBLE_MAGIC_VARIABLES.length).toBeGreaterThan(5);
    const names = ANSIBLE_MAGIC_VARIABLES.map((v) => v.name);
    expect(names).toContain('inventory_hostname');
    expect(names).toContain('group_names');
    expect(names).toContain('groups');
    expect(names).toContain('hostvars');
    ANSIBLE_MAGIC_VARIABLES.forEach((v) => {
      expect(v.source).toBe('magic variable');
      expect(v.preview.length).toBeGreaterThan(0);
    });
    // No overlap with ansible_facts — distinct namespaces.
    const factNames = new Set(ANSIBLE_FACT_VARIABLES.map((f) => f.name));
    names.forEach((n) => expect(factNames.has(n)).toBe(false));
  });
});
