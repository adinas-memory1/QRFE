import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../auth/auth.service';
import { SseConnectivityService } from '../offline/sse-connectivity.service';

describe('authInterceptor offline behavior', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: jasmine.SpyObj<AuthService>;
  let sseConnectivity: jasmine.SpyObj<SseConnectivityService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    auth = jasmine.createSpyObj('AuthService', [
      'refreshUserContext',
      'clearUser',
      'hydrateSessionFromStorageIfNeeded',
      'isAuthenticated',
    ]);
    auth.hydrateSessionFromStorageIfNeeded.and.stub();
    auth.isAuthenticated.and.returnValue(true);
    sseConnectivity = jasmine.createSpyObj('SseConnectivityService', [
      'reportHttpNetworkFailure',
      'reportStreamActivity',
    ]);
    router = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: SseConnectivityService, useValue: sseConnectivity },
        { provide: Router, useValue: router },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('status 0 marks offline and does not call refreshUserContext', () => {
    http.get('/api/restaurants/x/staff/metrics').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/restaurants/x/staff/metrics');
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    expect(sseConnectivity.reportHttpNetworkFailure).toHaveBeenCalled();
    expect(auth.refreshUserContext).not.toHaveBeenCalled();
    expect(auth.clearUser).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('401 while offline flag still attempts refresh and retries request', () => {
    auth.refreshUserContext.and.returnValue(
      of({ id: '1', role: 'manager', restaurantId: 'r1', restaurantName: 'R', restaurantType: 'Small' }),
    );

    let response: unknown;
    http.get('/api/user/ping').subscribe({
      next: body => (response = body),
      error: () => fail('should not error'),
    });

    const req1 = httpMock.expectOne('/api/user/ping');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(sseConnectivity.reportStreamActivity).toHaveBeenCalledWith('http-401');
    expect(auth.refreshUserContext).toHaveBeenCalledWith({ redirectOnFailure: false });

    const req2 = httpMock.expectOne('/api/user/ping');
    req2.flush({ id: '1', role: 'manager', restaurantId: 'r1' });

    expect(response).toEqual({ id: '1', role: 'manager', restaurantId: 'r1' });
  });

  it('401 on staff menu retries after refresh', () => {
    auth.refreshUserContext.and.returnValue(
      of({ id: '1', role: 'staff', restaurantId: 'r1', restaurantName: 'R', restaurantType: 'Small' }),
    );

    let response: unknown;
    http.get('/api/restaurants/r1/staff/menu').subscribe({
      next: body => (response = body),
      error: () => fail('should not error'),
    });

    const req1 = httpMock.expectOne('/api/restaurants/r1/staff/menu');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    const req2 = httpMock.expectOne('/api/restaurants/r1/staff/menu');
    req2.flush({ menuItems: [] });

    expect(response).toEqual({ menuItems: [] });
  });

  it('401 while online attempts refresh and retries request on success', () => {
    auth.refreshUserContext.and.returnValue(
      of({ id: '1', role: 'manager', restaurantId: 'r1', restaurantName: 'R', restaurantType: 'Small' })
    );

    let response: unknown;
    http.get('/api/restaurants/x/staff/tables/get-tables-status').subscribe({
      next: body => (response = body),
      error: () => fail('should not error'),
    });

    const req1 = httpMock.expectOne('/api/restaurants/x/staff/tables/get-tables-status');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(auth.refreshUserContext).toHaveBeenCalledWith({ redirectOnFailure: false });

    const req2 = httpMock.expectOne('/api/restaurants/x/staff/tables/get-tables-status');
    req2.flush({ ok: true });

    expect(response).toEqual({ ok: true });
    expect(auth.clearUser).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('401 retries when refresh returns null but session remains authenticated', () => {
    auth.refreshUserContext.and.returnValue(of(null));
    auth.isAuthenticated.and.returnValue(true);

    let response: unknown;
    http.get('/api/user/ping').subscribe({
      next: body => (response = body),
      error: () => fail('should not error'),
    });

    const req1 = httpMock.expectOne('/api/user/ping');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    const req2 = httpMock.expectOne('/api/user/ping');
    req2.flush({ id: '1', role: 'staff', restaurantId: 'r1' });

    expect(response).toEqual({ id: '1', role: 'staff', restaurantId: 'r1' });
  });

  it('401 while online with failed refresh only logs out on auth failure', () => {
    auth.refreshUserContext.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 0 }))
    );

    http.get('/api/restaurants/x/staff/metrics').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/restaurants/x/staff/metrics');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(auth.refreshUserContext).toHaveBeenCalled();
    expect(auth.clearUser).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('401 after refresh retry logs out instead of looping refresh', () => {
    auth.refreshUserContext.and.returnValue(
      of({ id: '1', role: 'manager', restaurantId: 'r1', restaurantName: 'R', restaurantType: 'Small' })
    );

    http.get('/api/restaurants/x/staff/metrics').subscribe({ error: () => {} });

    const req1 = httpMock.expectOne('/api/restaurants/x/staff/metrics');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    const req2 = httpMock.expectOne('/api/restaurants/x/staff/metrics');
    req2.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(auth.refreshUserContext).toHaveBeenCalledTimes(1);
    expect(auth.clearUser).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('401 on optional stripe status after refresh retry does not logout', () => {
    auth.refreshUserContext.and.returnValue(
      of({ id: '1', role: 'manager', restaurantId: 'r1', restaurantName: 'R', restaurantType: 'Small' }),
    );

    http.get('/api/stripe/subscription/status').subscribe({ error: () => {} });

    const req1 = httpMock.expectOne('/api/stripe/subscription/status');
    req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    const req2 = httpMock.expectOne('/api/stripe/subscription/status');
    req2.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(auth.refreshUserContext).toHaveBeenCalledTimes(1);
    expect(auth.clearUser).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
