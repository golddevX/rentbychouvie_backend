import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type HomepageSettings = {
  heroImage: string;
  editorial1Image: string;
  editorial2Image: string;
  breakImage: string;
  heroEyebrow?: string;
  heroTitle?: string;
  heroCopy?: string;
  heroCta?: string;
  editorial1Eyebrow?: string;
  editorial1Title?: string;
  editorial1Copy?: string;
  editorialCta?: string;
  storyTitle?: string;
  storyCta?: string;
  editorial2Eyebrow?: string;
  editorial2Title?: string;
  editorial2Copy?: string;
  breakEyebrow?: string;
  breakTitle?: string;
  breakCta?: string;
};

const HOMEPAGE_KEY = 'homepage';

const defaultHomepageSettings: HomepageSettings = {
  heroImage:
    'https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?auto=format&fit=crop&w=2200&q=92',
  editorial1Image:
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1500&q=90',
  editorial2Image:
    'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1500&q=90',
  breakImage:
    'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=2200&q=90',
};

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getHomepageSettings(): Promise<HomepageSettings> {
    const record = await this.prisma.siteSetting.findUnique({
      where: { key: HOMEPAGE_KEY },
    });

    if (!record) {
      return defaultHomepageSettings;
    }

    try {
      const parsed = JSON.parse(record.value) as HomepageSettings;
      return {
        ...defaultHomepageSettings,
        ...parsed,
      };
    } catch {
      return defaultHomepageSettings;
    }
  }

  async updateHomepageSettings(payload: Partial<HomepageSettings>) {
    const current = await this.getHomepageSettings();
    const next = {
      ...current,
      ...payload,
    };

    await this.prisma.siteSetting.upsert({
      where: { key: HOMEPAGE_KEY },
      create: {
        key: HOMEPAGE_KEY,
        value: JSON.stringify(next),
      },
      update: {
        value: JSON.stringify(next),
      },
    });

    return next;
  }
}

