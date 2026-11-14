import { templateRepository } from '../repositories/template.repository';
import { EventTemplate } from '../types/template.types';

export const templateService = {
  async listActive(): Promise<EventTemplate[]> {
    return templateRepository.listActive();
  },
};
