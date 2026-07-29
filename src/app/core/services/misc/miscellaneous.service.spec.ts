import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { MiscellaneousService } from './miscellaneous.service';

describe('MiscellaneousService', () => {
  let service: MiscellaneousService;

  beforeEach(() => {
    const httpSpy = jasmine.createSpyObj('HttpClient', ['get', 'post']);
    TestBed.configureTestingModule({
      providers: [
        MiscellaneousService,
        { provide: HttpClient, useValue: httpSpy }
      ]
    });
    service = TestBed.inject(MiscellaneousService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getTableCss returns warning for active waiter regardless of tableId casing', () => {
    const table = { tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', isTableOpen: true } as any;
    const waiterState = {
      'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE': 'active',
    } as any;
    expect(service.getTableCss(table, waiterState)).toBe('bg-warning text-dark');
  });
});
