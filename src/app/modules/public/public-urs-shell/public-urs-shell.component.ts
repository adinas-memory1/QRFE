import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewEncapsulation,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DropdownComponent, DropdownItemDirective, DropdownMenuDirective, DropdownToggleDirective } from '@coreui/angular';
import { NgClass } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { LANG_STORAGE_KEY, type AppLang } from '../../../core/i18n/transloco.config';
import { environment } from '../../../../environments/environment';
import { FeedbackLaunchComponent } from '@app/shared/components/feedback/feedback-launch.component';
import { FeedbackModalComponent } from '@app/shared/components/feedback/feedback-modal.component';
import { AppFooterContentComponent } from '@app/shared/components/layout/app-footer-content.component';

export interface PublicUrsNavLink {
  id: string;
  labelKey: string;
  /** When set, navigates to this route instead of an in-page section. */
  routePath?: string;
}

@Component({
  selector: 'app-public-urs-shell',
  standalone: true,
  imports: [
    RouterLink,
    DropdownComponent,
    DropdownItemDirective,
    DropdownMenuDirective,
    DropdownToggleDirective,
    TranslocoPipe,
    NgClass,
    FeedbackLaunchComponent,
    FeedbackModalComponent,
    AppFooterContentComponent,
  ],
  templateUrl: './public-urs-shell.component.html',
  styleUrls: ['../landing/landing.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class PublicUrsShellComponent implements OnInit, OnDestroy {
  /** When true, nav links route to `/#section` instead of scrolling in-page. */
  @Input() fragmentNav = false;
  @Input() activeSection = 'top';
  @Input() showFooter = true;
  @Input() showFeedback = true;
  @Input() mainTopPadding = '9rem';

  @Output() sectionNavigate = new EventEmitter<string>();

  theme: 'dark' | 'light' = 'dark';
  navStuck = false;
  navOpen = false;

  readonly year = new Date().getFullYear();
  readonly poweredBy = environment.poweredBy;
  readonly frontendPublicUrl = environment.apiUrl;
  readonly logoSrc = 'assets/urs.png';

  readonly navLinks: PublicUrsNavLink[] = [
    { id: 'features', labelKey: 'landing.nav.features' },
    { id: 'pricing', labelKey: 'landing.nav.pricing' },
    { id: 'how', labelKey: 'landing.nav.how' },
    { id: 'faq', labelKey: 'faq.navLink' },
    { id: 'contact', labelKey: 'landing.nav.contact', routePath: '/contact' },
  ];

  private readonly langFlagClass: Record<AppLang, string> = {
    ro: 'cif-ro',
    en: 'cif-us',
    it: 'cif-it',
    fr: 'cif-fr',
    es: 'cif-es',
    de: 'cif-de',
    sv: 'cif-se',
  };

  constructor(private transloco: TranslocoService) {}

  get activeLang(): AppLang {
    const l = this.transloco.getActiveLang();
    return (l === 'ro' || l === 'en' || l === 'it' || l === 'fr' || l === 'es' || l === 'de' || l === 'sv') ? l : 'en';
  }

  get activeLangFlagClass(): string {
    return this.langFlagClass[this.activeLang];
  }

  get outlineBtnColor(): 'light' | 'dark' {
    return this.theme === 'light' ? 'dark' : 'light';
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.navStuck = window.scrollY > 8;
  }

  ngOnInit(): void {
    const saved = (localStorage.getItem('publicTheme') as 'dark' | 'light' | null)
      ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.applyTheme(saved);
    this.onWindowScroll();
  }

  ngOnDestroy(): void {
    document.documentElement.removeAttribute('data-theme');
  }

  async setLanguage(l: AppLang): Promise<void> {
    this.transloco.setActiveLang(l);
    try { localStorage.setItem(LANG_STORAGE_KEY, l); } catch { /* ignore */ }
    await firstValueFrom(this.transloco.load(l));
  }

  toggleTheme(): void {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  toggleNav(): void {
    this.navOpen = !this.navOpen;
  }

  closeNav(): void {
    this.navOpen = false;
  }

  goToSection(sectionId: string): void {
    this.closeNav();
    this.sectionNavigate.emit(sectionId);
  }

  isNavActive(sectionId: string): boolean {
    return this.activeSection === sectionId;
  }

  private applyTheme(t: 'dark' | 'light'): void {
    this.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('publicTheme', t); } catch { /* ignore */ }
  }
}
