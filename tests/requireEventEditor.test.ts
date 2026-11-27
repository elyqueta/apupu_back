import { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireEventEditor } from '../src/middlewares/requireEventEditor';

function invoke(accessRole: string | undefined): NextFunction {
  const next = vi.fn();
  requireEventEditor(
    { accessRole } as unknown as Request,
    {} as Response,
    next as NextFunction
  );
  return next;
}

describe('requireEventEditor', () => {
  it('bloqueia membros da comunidade na edição do evento', () => {
    const next = invoke('communityMember');

    expect(next).toHaveBeenCalledOnce();
    const error = vi.mocked(next).mock.calls[0][0];
    expect(error).toBeDefined();
    expect((error as { code?: string }).code).toBe('community_member_forbidden');
  });

  it('permite anfitriões, gestores e convites por link', () => {
    expect(invoke('host')).toHaveBeenCalledWith();
    expect(invoke('manager')).toHaveBeenCalledWith();
    expect(invoke(undefined)).toHaveBeenCalledWith();
  });
});
