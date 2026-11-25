import { env } from '../config/env';
import { NotFoundError } from '../errors';
import { teamRepository } from '../repositories/team.repository';
import { EventAccessScope } from '../types/event.types';
import { TeamWithStats } from '../types/team.types';
import { destroyImage, uploadImage } from './cloudinary.service';
import { assertCanManageTeam, resolveTeamAccess } from './teamAccess.service';

const TEAM_NOT_FOUND = 'Equipa não encontrada.';

async function requireTeam(
  scope: EventAccessScope,
  teamId: string
): Promise<TeamWithStats> {
  const access = await resolveTeamAccess(teamId, scope);
  assertCanManageTeam(access.role);
  return access.team;
}

async function replacePhoto(
  teamId: string,
  previous: TeamWithStats,
  photo: { photoUrl: string | null; photoPublicId: string | null }
): Promise<TeamWithStats> {
  const updated = await teamRepository.update(teamId, photo);

  if (!updated) {
    throw new NotFoundError(TEAM_NOT_FOUND, 'team_not_found');
  }

  if (previous.photoPublicId && previous.photoPublicId !== photo.photoPublicId) {
    await destroyImage(previous.photoPublicId);
  }

  return updated;
}

export const teamPhotoService = {
  async upload(
    scope: EventAccessScope,
    teamId: string,
    buffer: Buffer,
    contentType: string
  ): Promise<TeamWithStats> {
    const team = await requireTeam(scope, teamId);

    const uploaded = await uploadImage(buffer, contentType, {
      folder: env.CLOUDINARY_TEAM_FOLDER,
      unavailableMessage: 'O upload da foto da equipa não está configurado.',
      unavailableCode: 'team_photo_upload_unavailable',
    });

    return replacePhoto(teamId, team, {
      photoUrl: uploaded.url,
      photoPublicId: uploaded.publicId,
    });
  },

  async remove(scope: EventAccessScope, teamId: string): Promise<TeamWithStats> {
    const team = await requireTeam(scope, teamId);

    if (!team.photoUrl && !team.photoPublicId) {
      return team;
    }

    return replacePhoto(teamId, team, {
      photoUrl: null,
      photoPublicId: null,
    });
  },
};
