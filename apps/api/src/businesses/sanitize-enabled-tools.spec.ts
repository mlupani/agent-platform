import { sanitizeEnabledTools } from './sanitize-enabled-tools';

describe('sanitizeEnabledTools', () => {
  it('trims, drops empties and deduplicates', () => {
    expect(
      sanitizeEnabledTools([' createLead ', 'createLead', '', 'createAppointment']),
    ).toEqual(['createLead', 'createAppointment']);
  });
});
