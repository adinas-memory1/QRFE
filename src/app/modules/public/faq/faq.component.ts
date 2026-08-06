import { Component, computed, DestroyRef, inject, input, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AccordionButtonDirective,
  AccordionComponent,
  AccordionItemComponent,
  ContainerComponent,
  TemplateIdDirective
} from '@coreui/angular';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { SeoService } from '../../../core/services/seo/seo.service';

/** FAQ entries must match `faq.items.<id>` in i18n JSON. */
const FAQ_ITEM_IDS = [
  'posApkDownload',
  'pwaSupportedBrowsers',
  'settingsCurrencyBeforeUse',
  'printerAgentDownload',
  'printerAgentInstall',
  'printerAgentReconnectAfterNetwork',
  'fiscalAndEscposPrintRouting',
  'epsonFiscalPrinterInstall',
  'managerTablesQrCodes',
  'resellerCreateRestaurant',
  'byodStaffDevices',
  'qrSignedSecurity',
  'bookingsSlotDuration',
  'guestOrderItemList',
  'confirmedOrderAddItems',
  'waiterCallVisual',
  'tableColors',
  'kitchenBarSse',
  'kitchenBarToastDismiss',
  'kitchenBarPickupVibration',
  'offlineOrders',
  'realtimeSync',
  'rolesAccess',
  'guestQrMenu',
  'orderEditsBlockedDuringPayment',
  'moveOrderConstraints',
  'dashboardReporting',
  'recipePortionsRemaining',
  'bookings',
  'languages',
  'subscriptionStripe'
] as const;

export type FaqItemId = (typeof FAQ_ITEM_IDS)[number];

const FAQ_VIDEO_URLS: Partial<Record<FaqItemId, string>> = {
  epsonFiscalPrinterInstall: 'https://youtu.be/TrKjoFBn6W4',
  managerTablesQrCodes: 'https://youtu.be/W4lfn0_UPf0',
  resellerCreateRestaurant: 'https://youtu.be/7XpJDz4PTS0',
};

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [
    AccordionComponent,
    AccordionItemComponent,
    AccordionButtonDirective,
    TemplateIdDirective,
    ContainerComponent,
    RouterLink,
    TranslocoPipe
  ],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.scss'
})
export class FaqComponent implements OnInit, OnDestroy {
  private readonly seo = inject(SeoService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  private faqJsonLdScript: HTMLScriptElement | null = null;

  protected readonly printerAgentDownloadUrl = environment.printerAgentDownloadUrl?.trim() ?? '';
  protected readonly posApkDownloadUrl = environment.posApkDownloadUrl?.trim() ?? '';

  ngOnInit(): void {
    if (!this.embedded()) {
      this.seo.applyPublicPage('faq');
      this.transloco.langChanges$
        .pipe(
          switchMap((lang) => this.transloco.load(lang)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => this.setFaqJsonLd());
      this.setFaqJsonLd();
    }
  }

  ngOnDestroy(): void {
    if (!this.embedded()) {
      this.seo.clearPublicPage();
      this.removeFaqJsonLd();
    }
  }

  protected readonly printerAgentInstallSteps = [
    'step1',
    'step2',
    'step3',
    'step4',
    'step5',
    'step6',
    'step7',
    'step8',
  ] as const;

  protected readonly fiscalPrintRoutingRows = ['confirm', 'print', 'fiscalReceipt'] as const;

  /** On the landing page: show only the first questions + link to `/faq`. */
  readonly compact = input(false);
  /** On the landing page: tighter section without “back home”. */
  readonly embedded = input(false);

  protected readonly allItemIds: readonly FaqItemId[] = FAQ_ITEM_IDS;

  protected readonly visibleItemIds = computed(() => {
    const ids = [...this.allItemIds];
    return this.compact() ? ids.slice(0, 6) : ids;
  });

  protected videoUrl(id: FaqItemId): string | undefined {
    return FAQ_VIDEO_URLS[id];
  }

  private setFaqJsonLd(): void {
    const mainEntity = FAQ_ITEM_IDS.map((id) => ({
      '@type': 'Question',
      name: this.transloco.translate(`faq.items.${id}.q`),
      acceptedAnswer: {
        '@type': 'Answer',
        text: this.transloco.translate(`faq.items.${id}.a`),
      },
    }));

    const payload = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity,
    };

    if (!this.faqJsonLdScript) {
      this.faqJsonLdScript = document.createElement('script');
      this.faqJsonLdScript.type = 'application/ld+json';
      this.faqJsonLdScript.setAttribute('data-faq-jsonld', 'true');
      document.head.appendChild(this.faqJsonLdScript);
    }
    this.faqJsonLdScript.textContent = JSON.stringify(payload);
  }

  private removeFaqJsonLd(): void {
    if (this.faqJsonLdScript?.parentNode) {
      this.faqJsonLdScript.parentNode.removeChild(this.faqJsonLdScript);
    }
    this.faqJsonLdScript = null;
  }
}
