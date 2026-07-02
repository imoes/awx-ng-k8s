import * as Blockly from 'blockly';
import { registerBlocks } from './blocks';
import { parseConditionExpr, parseConditionToBlock } from './conditionParser';
import { conditionBlockToExpr } from './ansibleGenerator';

describe('conditionParser', () => {
  let workspace;

  beforeAll(() => {
    registerBlocks();
  });

  beforeEach(() => {
    workspace = new Blockly.Workspace();
  });

  afterEach(() => {
    workspace.dispose();
  });

  // Round-trips a when: expression through parse → blocks → regenerate and
  // asserts the block type is NOT cond_raw (i.e. it was actually decomposed).
  function expectDecomposed(expr) {
    const block = parseConditionToBlock(workspace, expr);
    expect(block.type).not.toBe('cond_raw');
    return block;
  }

  it('parses a bare truthy variable (e.g. "when: docker.proxy")', () => {
    const block = expectDecomposed('docker.proxy');
    expect(block.type).toBe('cond_var');
    expect(conditionBlockToExpr(block)).toBe('docker.proxy');
  });

  it('parses an equality comparison with a string literal', () => {
    const block = expectDecomposed("ansible_facts['distribution'] == \"Debian\"");
    expect(block.type).toBe('cond_compare');
    expect(conditionBlockToExpr(block)).toBe("ansible_facts['distribution'] == 'Debian'");
  });

  it('parses a numeric comparison with an int filter-free number', () => {
    const block = expectDecomposed('ansible_facts["distribution_major_version"] >= 6');
    expect(block.type).toBe('cond_compare');
    expect(conditionBlockToExpr(block)).toBe('ansible_facts["distribution_major_version"] >= 6');
  });

  it('parses "is defined" / "is not defined" tests', () => {
    const b1 = expectDecomposed('foo is defined');
    expect(b1.type).toBe('cond_test');
    expect(conditionBlockToExpr(b1)).toBe('foo is defined');

    const b2 = expectDecomposed('foo is not defined');
    expect(b2.type).toBe('cond_test');
    expect(conditionBlockToExpr(b2)).toBe('foo is not defined');
  });

  it('parses the real repo example "not _containerd_dir.stat.exists" without extra parens', () => {
    const block = expectDecomposed('not _containerd_dir.stat.exists');
    expect(block.type).toBe('cond_not');
    expect(conditionBlockToExpr(block)).toBe('not _containerd_dir.stat.exists');
  });

  it('parses the real repo example "docker.proxy is defined"', () => {
    const block = expectDecomposed('docker.proxy is defined');
    expect(conditionBlockToExpr(block)).toBe('docker.proxy is defined');
  });

  it('parses "and"/"or" combinations and list membership', () => {
    const and = expectDecomposed(
      'ansible_facts[\'distribution\'] == "CentOS" and ansible_facts[\'distribution_major_version\'] == "6"'
    );
    expect(and.type).toBe('cond_logic');
    expect(conditionBlockToExpr(and)).toBe(
      "(ansible_facts['distribution'] == 'CentOS' and ansible_facts['distribution_major_version'] == '6')"
    );

    const inExpr = expectDecomposed("'webservers' in group_names");
    expect(inExpr.type).toBe('cond_compare');
    expect(conditionBlockToExpr(inExpr)).toBe("'webservers' in group_names");
  });

  it('parses parenthesized precedence groups', () => {
    const block = expectDecomposed('(a == 1 and b == 2) or c == 3');
    expect(block.type).toBe('cond_logic');
    expect(conditionBlockToExpr(block)).toBe('((a == 1 and b == 2) or c == 3)');
  });

  it('falls back to cond_raw for expressions outside the supported grammar (filters, jinja braces)', () => {
    const block = parseConditionToBlock(workspace, "ansible_facts['distribution_major_version'] | int >= 6");
    expect(block.type).toBe('cond_raw');
    expect(conditionBlockToExpr(block)).toBe("ansible_facts['distribution_major_version'] | int >= 6");
  });

  it('parseConditionExpr returns null for unparseable text (used by the raw-fallback caller)', () => {
    expect(parseConditionExpr('motd_contents.stdout.find("hi") != -1')).toBeNull();
  });
});
