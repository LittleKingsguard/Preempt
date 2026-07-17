// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clientAPI } from '../../../src/core/ClientAPI';
import { Node } from '../../../src/core/Node';

describe('ClientAPI', () => {
  let node;

  beforeEach(() => {
    node = new Node({ type: 'div', props: { class: 'old' } });
    node.receiveNextState = vi.fn();
  });

  it('modifyNode constructs a NextState object and passes it to the node instead of direct mutation', async () => {
    clientAPI.modifyNode({ props: { class: 'new' } }, node);
    
    // It should not mutate directly
    expect(node.data.props.class).toBe('old');
    
    // Instead it calls receiveNextState
    expect(node.receiveNextState).toHaveBeenCalledWith(
      expect.objectContaining({ props: { class: 'new' } })
    );
  });

  it('modifyNode does not call Supervisor.rerun directly', async () => {
    global.Supervisor = { rerun: vi.fn() };
    node.render = vi.fn(); // Prevent DOM crash since we have no document in tests
    
    clientAPI.modifyNode({ props: { class: 'new' } }, node);
    
    expect(global.Supervisor.rerun).not.toHaveBeenCalled();
  });
});
