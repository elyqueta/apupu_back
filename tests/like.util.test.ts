import { describe, expect, it } from 'vitest';
import { escapeLike } from '../src/utils/like.util';

describe('escapeLike', () => {
  it('escapes SQL LIKE wildcards and the escape character', () => {
    expect(escapeLike('Ana_%\\Silva')).toBe('Ana\\_\\%\\\\Silva');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeLike('João 244900000000')).toBe('João 244900000000');
  });
});
