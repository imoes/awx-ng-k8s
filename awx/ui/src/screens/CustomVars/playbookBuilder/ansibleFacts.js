// awx-ng: curated list of the most commonly referenced ansible_facts (from
// the "Ansible facts" gathered by setup/gather_facts). There's no way to
// discover these dynamically inside the builder (they only exist at play
// runtime on the target host), so — like blocks.js's CURATED_CHOICES for
// package.state — a small hand-picked list covers the common case. Shown in
// the Variables panel alongside role/vault variables so users can drag one
// straight into a when: condition (see conditionParser.js's "is defined"/
// comparison support) without having to remember exact fact names.
const ANSIBLE_FACTS = [
  ['ansible_facts[\'distribution\']', 'OS name, e.g. Debian, Ubuntu, CentOS'],
  ['ansible_facts[\'distribution_version\']', 'Full OS version string, e.g. 22.04'],
  ['ansible_facts[\'distribution_major_version\']', 'Major OS version, e.g. 22 (string)'],
  ['ansible_facts[\'os_family\']', 'OS family, e.g. Debian, RedHat'],
  ['ansible_facts[\'hostname\']', 'Short hostname'],
  ['ansible_facts[\'fqdn\']', 'Fully qualified domain name'],
  ['ansible_facts[\'default_ipv4\'][\'address\']', 'Primary IPv4 address'],
  ['ansible_facts[\'all_ipv4_addresses\']', 'List of all IPv4 addresses'],
  ['ansible_facts[\'architecture\']', 'CPU architecture, e.g. x86_64'],
  ['ansible_facts[\'processor_vcpus\']', 'Number of virtual CPUs'],
  ['ansible_facts[\'memtotal_mb\']', 'Total RAM in MB'],
  ['ansible_facts[\'memfree_mb\']', 'Free RAM in MB'],
  ['ansible_facts[\'kernel\']', 'Kernel version'],
  ['ansible_facts[\'system\']', 'OS kernel name, e.g. Linux'],
  ['ansible_facts[\'domain\']', 'DNS domain'],
  ['ansible_facts[\'virtualization_type\']', 'e.g. kvm, vmware, docker, lxc'],
  ['ansible_facts[\'virtualization_role\']', 'guest or host'],
  ['ansible_facts[\'date_time\'][\'date\']', 'Current date on the target (YYYY-MM-DD)'],
  ['ansible_facts[\'env\'][\'PATH\']', 'Remote user\'s PATH environment variable'],
  ['ansible_facts[\'selinux\'][\'status\']', 'SELinux status, e.g. enabled/disabled'],
];

// Matches the {name, source, preview} shape VariablesPanel already renders
// for role/vault variables (see VariablesPanel.js's loadVariables()).
export const ANSIBLE_FACT_VARIABLES = ANSIBLE_FACTS.map(([name, preview]) => ({
  name,
  source: 'ansible fact',
  preview,
}));
