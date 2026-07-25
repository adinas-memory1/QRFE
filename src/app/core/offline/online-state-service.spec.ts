import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { OnlineStateService } from './online-state-service';
import { SseConnectivityService } from './sse-connectivity.service';
import { firstValueFrom } from 'rxjs';

describe('OnlineStateService', () => {
  let service: OnlineStateService;
  let fetchSpy: jasmine.Spy;
  let sseConnectivity: jasmine.SpyObj<SseConnectivityService>;

  const pingLiteFetchCalls = (): number =>
    fetchSpy.calls.all().filter(call => String(call.args[0]).includes('/api/ping-lite')).length;

  const lastPingLiteFetch = (): jasmine.CallInfo<typeof fetch> | undefined =>
    fetchSpy.calls.all().filter(call => String(call.args[0]).includes('/api/ping-lite')).pop();

  beforeEach(() => {
    fetchSpy = jasmine.createSpy('fetch').and.returnValue(
      Promise.resolve({ ok: true, status: 200 }),
    );
    spyOn(window, 'fetch').and.callFake(fetchSpy);

    sseConnectivity = jasmine.createSpyObj('SseConnectivityService', [
      'reportPingSuccess',
      'reportPingFailed',
      'isStreamActive',
    ]);
    sseConnectivity.isStreamActive.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        OnlineStateService,
        { provide: SseConnectivityService, useValue: sseConnectivity },
      ],
    });
    service = TestBed.inject(OnlineStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
    expect(service.isOnline).toBe(true);
  });

  it('setOffline toggles isOnline and emits on online$', fakeAsync(() => {
    const emissions: boolean[] = [];
    service.online$.subscribe(v => emissions.push(v));

    service.setOffline();
    tick();

    expect(service.isOnline).toBe(false);
    expect(emissions).toContain(false);
  }));

  it('setOnline restores isOnline after setOffline', () => {
    service.setOffline();
    service.setOnline();
    expect(service.isOnline).toBe(true);
  });

  it('triggerResumeCheck debounces and emits resumeConnectivityOk$ after ping', fakeAsync(async () => {
    const resumePromise = firstValueFrom(service.resumeConnectivityOk$);

    service.triggerResumeCheck();
    service.triggerResumeCheck();
    tick(299);
    expect(pingLiteFetchCalls()).toBe(0);

    tick(1);
    await resumePromise;

    expect(pingLiteFetchCalls()).toBe(1);
    const lastPing = lastPingLiteFetch();
    expect(lastPing?.args[0]).toContain('/api/ping-lite');
    expect(lastPing?.args[1]?.method).toBe('HEAD');
  }));

  it('does not emit resumeConnectivityOk$ when ping fails', fakeAsync(() => {
    fetchSpy.and.returnValue(Promise.resolve({ ok: false, status: 503 }));
    let emitted = false;
    service.resumeConnectivityOk$.subscribe(() => { emitted = true; });

    service.triggerResumeCheck();
    tick(300);

    expect(emitted).toBe(false);
  }));

  it('does not mark offline on transient gateway 504 when browser is online', fakeAsync(async () => {
    fetchSpy.and.returnValue(Promise.resolve({ ok: false, status: 504 }));
    sseConnectivity.isStreamActive.and.returnValue(false);

    await service.confirmConnectivity(true);
    tick();

    expect(sseConnectivity.reportPingFailed).not.toHaveBeenCalled();
    expect(service.isOnline).toBe(true);
  }));

  it('still marks offline on non-transient HTTP 500 when stream inactive', fakeAsync(async () => {
    fetchSpy.and.returnValue(Promise.resolve({ ok: false, status: 500 }));
    sseConnectivity.isStreamActive.and.returnValue(false);

    await service.confirmConnectivity(true);
    tick();

    expect(sseConnectivity.reportPingFailed).toHaveBeenCalledWith('ping-lite-fail');
  }));

  it('confirmConnectivity emits resume path even when already online', fakeAsync(async () => {
    expect(service.isOnline).toBe(true);
    const resumePromise = firstValueFrom(service.resumeConnectivityOk$);

    service.triggerResumeCheck();
    tick(300);
    await resumePromise;

    expect(service.isOnline).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
  }));

  it('emits pingOk$ when ping-lite returns HTTP 200', fakeAsync(async () => {
    const pingPromise = firstValueFrom(service.pingOk$);
    await service.confirmConnectivity(true);
    tick();
    await pingPromise;
    expect(fetchSpy).toHaveBeenCalled();
  }));

  it('runs supplemental ping-lite heartbeat every 5 seconds when SSE inactive', fakeAsync(() => {
    fetchSpy.calls.reset();
    TestBed.resetTestingModule();
    const sse = jasmine.createSpyObj('SseConnectivityService', [
      'reportPingSuccess',
      'reportPingFailed',
      'isStreamActive',
    ]);
    sse.isStreamActive.and.returnValue(false);
    TestBed.configureTestingModule({
      providers: [
        OnlineStateService,
        { provide: SseConnectivityService, useValue: sse },
      ],
    });
    TestBed.inject(OnlineStateService);

    tick(5_000);
    expect(pingLiteFetchCalls()).toBe(1);
    tick(5_000);
    expect(pingLiteFetchCalls()).toBe(2);
    discardPeriodicTasks();
  }));

  it('skips supplemental ping-lite when SSE stream is active', fakeAsync(() => {
    fetchSpy.calls.reset();
    sseConnectivity.isStreamActive.and.returnValue(true);
    tick(5_000);
    expect(pingLiteFetchCalls()).toBe(0);
    discardPeriodicTasks();
  }));

  it('triggerResumeCheck ignores duplicate resume within cooldown', fakeAsync(() => {
    service.triggerResumeCheck();
    tick(300);
    expect(pingLiteFetchCalls()).toBe(1);

    service.triggerResumeCheck();
    tick(300);
    expect(pingLiteFetchCalls()).toBe(1);
  }));
});
