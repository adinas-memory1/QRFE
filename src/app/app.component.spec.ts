import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTransloco } from '@jsverse/transloco';
import { AppComponent } from './app.component';
import { AuthService } from './core/auth/auth.service';
import { OrderSyncService } from './core/services/order-service/order-sync.service';
import { OnlineStateService } from './core/offline/online-state-service';
import { OfflinePolicyService } from './core/offline/offline-policy.service';
import { ColorModeService } from '@coreui/angular';
import { IconSetService } from '@coreui/icons-angular';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY, of } from 'rxjs';

describe('AppComponent', () => {
  let authSpy: any;
  let orderSyncSpy: any;
  let onlineStateSpy: any;
  let colorModeSpy: any;

  beforeEach(async () => {
    authSpy = {
      getUserContext: () => of({ id: '1', role: 'manager', restaurantId: '123' }),
      user$: of({ id: '1', role: 'manager', restaurantId: '123' }),
      restoreSession: () => of(true),
      pingSession: () => of(true),
      hydrateSessionFromStorageIfNeeded: () => {},
      isAuthenticated: () => false,
      getUserRole: () => 'manager',
    };

    orderSyncSpy = {
      listenToRestaurantEvents: jasmine.createSpy('listenToRestaurantEvents').and.returnValue(of({}))
    };

    onlineStateSpy = {
      isOnline: true,
      online$: of(true),
      pingOk$: of(undefined),
    };

    colorModeSpy = {
      localStorageItemName: { set: jasmine.createSpy('set') },
      eventName: { set: jasmine.createSpy('set') }
    };

    await TestBed.configureTestingModule({
      imports: [
        AppComponent
      ],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTransloco({
          config: {
            availableLangs: ['en', 'ro'],
            defaultLang: 'en',
            fallbackLang: 'en',
            reRenderOnLangChange: true,
            prodMode: true
          }
        }),
        IconSetService,
        { provide: AuthService, useValue: authSpy },
        { provide: OrderSyncService, useValue: orderSyncSpy },
        { provide: OnlineStateService, useValue: onlineStateSpy },
        {
          provide: OfflinePolicyService,
          useValue: {
            canUseFullOffline: () => false,
          },
        },
        { provide: ColorModeService, useValue: colorModeSpy },
        {
          provide: SwUpdate,
          useValue: {
            isEnabled: false,
            versionUpdates: EMPTY,
            checkForUpdate: () => Promise.resolve(false),
            activateUpdate: () => Promise.resolve(false),
          },
        }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have as title 'U.R.S.'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('U.R.S.');
  });
});
