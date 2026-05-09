import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RentalPricingService } from '../pricing/rental-pricing.service';
import { ClientSettings, clientSettingsDefaults, PublicClientSettings } from './client-settings.types';

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
const CLIENT_SETTINGS_KEY = 'client-settings-v1';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly rentalPricingService: RentalPricingService,
  ) {}

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

  async getClientSettings(): Promise<ClientSettings> {
    const record = await this.prisma.siteSetting.findUnique({
      where: { key: CLIENT_SETTINGS_KEY },
    });

    if (!record) {
      return clientSettingsDefaults;
    }

    try {
      const parsed = JSON.parse(record.value) as Partial<ClientSettings>;
      return {
        ...clientSettingsDefaults,
        ...parsed,
        brandingJson: { ...clientSettingsDefaults.brandingJson, ...parsed.brandingJson },
        homepageJson: { ...clientSettingsDefaults.homepageJson, ...parsed.homepageJson },
        catalogJson: { ...clientSettingsDefaults.catalogJson, ...parsed.catalogJson },
        productDetailJson: { ...clientSettingsDefaults.productDetailJson, ...parsed.productDetailJson },
        inquiryJson: { ...clientSettingsDefaults.inquiryJson, ...parsed.inquiryJson },
        previewJson: { ...clientSettingsDefaults.previewJson, ...parsed.previewJson },
        navigationJson: {
          ...clientSettingsDefaults.navigationJson,
          ...parsed.navigationJson,
          topNavItems: parsed.navigationJson?.topNavItems ?? clientSettingsDefaults.navigationJson.topNavItems,
        },
        footerJson: {
          ...clientSettingsDefaults.footerJson,
          ...parsed.footerJson,
          socialLinks: parsed.footerJson?.socialLinks ?? clientSettingsDefaults.footerJson.socialLinks,
          footerLinks: parsed.footerJson?.footerLinks ?? clientSettingsDefaults.footerJson.footerLinks,
        },
        seoJson: { ...clientSettingsDefaults.seoJson, ...parsed.seoJson },
        i18nJson: { ...clientSettingsDefaults.i18nJson, ...parsed.i18nJson },
        policiesJson: { ...clientSettingsDefaults.policiesJson, ...parsed.policiesJson },
      };
    } catch {
      return clientSettingsDefaults;
    }
  }

  async updateClientSettings(payload: Partial<ClientSettings> | ClientSettings) {
    const current = await this.getClientSettings();
    const next: ClientSettings = {
      ...current,
      ...payload,
      brandingJson: { ...current.brandingJson, ...(payload as Partial<ClientSettings>).brandingJson },
      homepageJson: { ...current.homepageJson, ...(payload as Partial<ClientSettings>).homepageJson },
      catalogJson: { ...current.catalogJson, ...(payload as Partial<ClientSettings>).catalogJson },
      productDetailJson: { ...current.productDetailJson, ...(payload as Partial<ClientSettings>).productDetailJson },
      inquiryJson: { ...current.inquiryJson, ...(payload as Partial<ClientSettings>).inquiryJson },
      previewJson: { ...current.previewJson, ...(payload as Partial<ClientSettings>).previewJson },
      navigationJson: {
        ...current.navigationJson,
        ...(payload as Partial<ClientSettings>).navigationJson,
      },
      footerJson: {
        ...current.footerJson,
        ...(payload as Partial<ClientSettings>).footerJson,
      },
      seoJson: { ...current.seoJson, ...(payload as Partial<ClientSettings>).seoJson },
      i18nJson: { ...current.i18nJson, ...(payload as Partial<ClientSettings>).i18nJson },
      policiesJson: { ...current.policiesJson, ...(payload as Partial<ClientSettings>).policiesJson },
      updatedAt: new Date().toISOString(),
    };

    await this.prisma.siteSetting.upsert({
      where: { key: CLIENT_SETTINGS_KEY },
      create: {
        key: CLIENT_SETTINGS_KEY,
        value: JSON.stringify(next),
      },
      update: {
        value: JSON.stringify(next),
      },
    });

    return next;
  }

  async getPublicClientSettings(): Promise<PublicClientSettings> {
    const settings = await this.getClientSettings();
    const depositPolicy = this.rentalPricingService.getDepositPolicy();

    return {
      branding: {
        brandName: settings.brandingJson.brandName,
        tagline: settings.brandingJson.tagline,
        logoUrl: settings.brandingJson.logoUrl,
        faviconUrl: settings.brandingJson.faviconUrl,
        accentPreset: settings.brandingJson.accentPreset,
      },
      hero: {
        image: settings.brandingJson.heroImage,
        title: settings.homepageJson.heroTitle,
        subtitle: settings.homepageJson.heroSubtitle,
        ctaText: settings.homepageJson.ctaText,
        announcementEnabled: settings.homepageJson.announcementEnabled,
        announcementText: settings.homepageJson.announcementText,
      },
      homepage: {
        featuredSections: settings.homepageJson.featuredSections,
        editorialBlocks: settings.homepageJson.editorialBlocks,
        trustBlock: settings.inquiryJson.trustBlock,
      },
      catalog: settings.catalogJson,
      productDetail: {
        sectionOrder: settings.productDetailJson.sectionOrder,
        showStylistNote: settings.productDetailJson.showStylistNote,
        showMeasurements: settings.productDetailJson.showMeasurements,
        showFabrics: settings.productDetailJson.showFabrics,
        relatedProductsMode: settings.productDetailJson.relatedProductsMode,
        relatedProductsLimit: settings.productDetailJson.relatedProductsLimit,
        rentalNoteBlock: settings.productDetailJson.rentalNoteBlock,
        showProductValue: true,
        showAvailability: true,
        showStatus: true,
        showCategory: true,
        showMetadata: true,
      },
      inquiry: {
        ...settings.inquiryJson,
        appointmentIntentOptions: ['fitting', 'pickup', 'delivery'],
      },
      preview: settings.previewJson,
      navigation: settings.navigationJson,
      footer: {
        ...settings.footerJson,
        line: settings.brandingJson.tagline,
        appointmentLabel: 'Private appointment',
        noPaymentLabel: 'No online payment',
        fittingLabel: 'Store fitting',
      },
      seo: settings.seoJson,
      i18n: settings.i18nJson,
      policies: settings.policiesJson,
      depositPolicy: {
        allowCustomDepositAmount: depositPolicy.allowCustomDepositAmount,
        allowedDepositRates: depositPolicy.allowedDepositRates,
        defaultDepositRate: depositPolicy.defaultDepositRate,
      },
      contact: {
        email: settings.footerJson.contactEmail,
        hotline: settings.footerJson.hotline,
        zalo: settings.footerJson.zalo,
        address: settings.footerJson.address,
      },
    };
  }
}
