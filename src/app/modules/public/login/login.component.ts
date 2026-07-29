import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { NgStyle } from '@angular/common';
import { IconDirective } from '@coreui/icons-angular';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { AuthService, normalizeUserContext } from '../../../core/auth/auth.service';
import { navigateToRoleHome } from '../../../core/auth/auth-redirect.util';
import {
  ButtonDirective,
  CardBodyComponent,
  CardComponent,
  CardGroupComponent,
  ColComponent,
  ContainerComponent,
  FormControlDirective,
  FormDirective,
  InputGroupComponent,
  InputGroupTextDirective,
  RowComponent
} from '@coreui/angular';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { emailFieldValidators } from '../../../core/validators/email.validator';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SubscriptionService } from '../../../core/services/subscription-service/subscription.service';
import { AppToastService } from '../../../core/services/toast-service/toast-service.service';
import { MiscellaneousService } from '../../../core/services/misc/miscellaneous.service';
import { UserContextModel } from '../../../core/models/userContextModel';
import { agentDebugLog } from '../../../core/debug/agent-debug.logger';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  standalone: true,
  imports: [RouterLink, ContainerComponent, RowComponent, ColComponent,
    CardGroupComponent, CardComponent, CardBodyComponent, FormDirective,
    InputGroupComponent, InputGroupTextDirective, IconDirective,
    FormControlDirective, ButtonDirective, NgStyle, ReactiveFormsModule,
    TranslocoPipe]
})
export class LoginComponent implements OnInit, OnDestroy {

  loginForm: FormGroup;

  constructor(private router: Router,
    private route: ActivatedRoute,
    private fb: FormBuilder,
    private authService: AuthService,
    private subscriptionService: SubscriptionService,
    private toast: AppToastService,
    private misc: MiscellaneousService,
    private transloco: TranslocoService,
    private seo: SeoService) {
    this.loginForm = this.fb.group({
      email: ['', emailFieldValidators],
      password: ['', Validators.required],
    });
  }


  get showCreateAccountLink(): boolean {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl?.startsWith('/reseller')) {
      return false;
    }
    if (this.route.snapshot.queryParamMap.get('partnerLogin') === 'true') {
      return false;
    }
    return true;
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const formValue = this.loginForm.value;

    this.authService.clearUser();

    this.authService.loginUser(formValue).subscribe({
      next: (response: unknown) => {
        void this.completeLogin(response, formValue.email);
      },
      error: (error: unknown) => {
        console.error('Login failed:', error);
        this.toast.error(this.misc.getFirstErrorMessage(error), this.transloco.translate('common.loginFailed'));
      },
    });
  }

  private async completeLogin(response: unknown, loginEmail: unknown): Promise<void> {
    const user = normalizeUserContext(response);
    if (!user) {
      this.toast.error(this.transloco.translate('common.loginFailed'));
      return;
    }
    if (!user.email && loginEmail) {
      user.email = String(loginEmail).trim();
    }
    if (!user.displayName) {
      user.displayName = user.name && user.surname
        ? `${user.surname} ${user.name.charAt(0).toUpperCase()}.`
        : user.email?.split('@')[0] ?? null;
    }
    this.authService.setUser(user);
    this.authService.setRestaurantCtx();

    const confirmed = await firstValueFrom(this.authService.pingSession(false));
    if (!confirmed) {
      this.toast.error(this.transloco.translate('common.loginFailed'));
      return;
    }
    if (confirmed.id !== user.id) {
      // #region agent log
      agentDebugLog('A5', 'login.completeLogin', 'ping-user-mismatch-trust-login', {
        loginUserId: user.id,
        pingUserId: confirmed.id,
        loginEmail: user.email ?? null,
        pingEmail: confirmed.email ?? null,
      });
      // #endregion
      this.authService.setUser(user);
    }

    const returnUrl = this.route.snapshot.queryParams['returnUrl'];
    await navigateToRoleHome(this.router, this.subscriptionService, user.role, returnUrl);
  }

  async ngOnInit(): Promise<void> {
    this.seo.applyNoIndex();

    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const returnUrl = this.route.snapshot.queryParams['returnUrl'];

    if (this.authService.isAuthenticated()) {
      await navigateToRoleHome(this.router, this.subscriptionService, this.authService.getUserRole(), returnUrl);
      return;
    }

    const user = await firstValueFrom(this.authService.refreshUserContext({ redirectOnFailure: false }));
    if (user) {
      await navigateToRoleHome(this.router, this.subscriptionService, user.role, returnUrl);
    }
  }

  ngOnDestroy(): void {
    // lean up subscriptions or resources if needed
  }

}
