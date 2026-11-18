import { describe, expect, it } from 'vitest';
import {
  csvCell,
  csvDocument,
  csvRow,
  documentCode,
  exportDateStamp,
  exportFilename,
  formatAngolaPhone,
  formatCalendarDate,
  formatDisplayDateTime,
  formatExportDateTime,
  formatExportNumber,
  formatKz,
  formatReportCount,
  formatReportPercent,
  formatWeekdayDateTime,
  periodExportFilename,
  protectCsvFormula,
  reportDocumentCode,
  reportResponseRate,
  reportRowIsConsistent,
  slugify,
} from '../src/utils/exportFormat.util';

describe('exportFormat.util', () => {
  it('apresenta datas em Africa/Luanda', () => {
    const value = new Date('2026-11-22T14:00:00Z');

    expect(formatDisplayDateTime(value)).toBe('22 nov 2026, 15:00');
    expect(formatExportDateTime(value)).toBe('2026-11-22 15:00');
    expect(exportDateStamp(value)).toBe('2026-11-22');
  });

  it('devolve string vazia para datas ausentes ou inválidas', () => {
    expect(formatDisplayDateTime(null)).toBe('');
    expect(formatExportDateTime('não é uma data')).toBe('');
  });

  it('apresenta datas de calendário sem deslocar o dia', () => {
    expect(formatCalendarDate('2026-11-01')).toBe('01 nov 2026');
    expect(formatCalendarDate('2026-12-31')).toBe('31 dez 2026');
    expect(formatCalendarDate('2026-02-30')).toBe('');
    expect(formatCalendarDate('01/11/2026')).toBe('');
  });

  it('formata kwanzas com espaço de milhares e vírgula decimal', () => {
    expect(formatKz(12_500)).toBe('12 500,00 Kz');
    expect(formatKz(0)).toBe('0,00 Kz');
    expect(formatKz(1_234_567.5)).toBe('1 234 567,50 Kz');
    expect(formatKz(-2_500)).toBe('-2 500,00 Kz');
  });

  it('formata números CSV sem milhares e com vírgula decimal', () => {
    expect(formatExportNumber(12_500)).toBe('12500,00');
    expect(formatExportNumber(12.5)).toBe('12,50');
    expect(formatExportNumber(75, 1)).toBe('75,0');
    expect(formatExportNumber(Number.NaN)).toBe('');
  });

  it('normaliza telemóveis angolanos', () => {
    expect(formatAngolaPhone('+244 923 456 789')).toBe('+244 923 456 789');
    expect(formatAngolaPhone('923456789')).toBe('+244 923 456 789');
    expect(formatAngolaPhone('244923456789')).toBe('+244 923 456 789');
    expect(formatAngolaPhone('+351 912 345 678')).toBe('+351 912 345 678');
    expect(formatAngolaPhone(null)).toBe('');
  });

  it('protege fórmulas no início da célula', () => {
    expect(protectCsvFormula('=SOMA(A1:A2)')).toBe("'=SOMA(A1:A2)");
    expect(protectCsvFormula('+244 923 456 789')).toBe("'+244 923 456 789");
    expect(protectCsvFormula('-1')).toBe("'-1");
    expect(protectCsvFormula('@user')).toBe("'@user");
    expect(protectCsvFormula('  =1+1')).toBe("'  =1+1");
    expect(protectCsvFormula('texto normal')).toBe('texto normal');
  });

  it('escapa aspas e separadores nas células CSV', () => {
    expect(csvCell('Olá; mundo')).toBe('"Olá; mundo"');
    expect(csvCell('Diz "olá"')).toBe('"Diz ""olá"""');
    expect(csvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(12.5)).toBe('12,50');
  });

  it('constrói linhas e documentos com BOM e CRLF', () => {
    expect(csvRow(['Nome', 'Estado'])).toBe('Nome;Estado');

    const document = csvDocument(['Nome;Estado', 'Ana;Confirmado']);
    expect(document.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(document.toString('utf8')).toBe('\uFEFFNome;Estado\r\nAna;Confirmado\r\n');
  });

  it('cria slugs e nomes de ficheiro estáveis', () => {
    expect(slugify('Casamento da Ana & do João — Edição Especial')).toBe(
      'casamento-da-ana-do-joao-edicao-especial'
    );
    expect(slugify('***')).toBe('evento');

    expect(
      exportFilename(
        'convidados',
        'Casamento da Ana & do João',
        new Date('2026-11-18T10:00:00Z'),
        'pdf'
      )
    ).toBe('conto-contigo_convidados_casamento-da-ana-do-joao_2026-11-18.pdf');

    expect(
      periodExportFilename(
        'relatorio',
        'Casamento da Ana & do João',
        '2026-11-01',
        '2026-11-30',
        'csv'
      )
    ).toBe(
      'conto-contigo_relatorio_casamento-da-ana-do-joao_2026-11-01_a_2026-11-30.csv'
    );
  });

  it('deriva o código do documento do evento e do ano', () => {
    const generatedAt = new Date('2026-11-18T10:00:00Z');

    expect(
      documentCode('CC-LST', '11111111-2222-4333-8444-555555555555', generatedAt)
    ).toBe('CC-LST-2026-655765');
  });

  it('formata percentagens do relatório com espaço antes do %', () => {
    expect(formatReportPercent(0.75)).toBe('75 %');
    expect(formatReportPercent(7 / 12)).toBe('58 %');
    expect(formatReportPercent(0)).toBe('0 %');
    expect(formatReportPercent(1)).toBe('100 %');
  });

  it('apresenta a data do evento com dia da semana e ponto médio', () => {
    expect(formatWeekdayDateTime(new Date('2026-11-21T14:00:00Z'))).toBe(
      'sáb, 21 nov 2026 · 15:00'
    );
    expect(formatWeekdayDateTime(new Date('2026-11-18T10:00:00Z'))).toBe(
      'qua, 18 nov 2026 · 11:00'
    );
    expect(formatWeekdayDateTime(null)).toBe('');
  });

  it('agrupa contagens grandes sem partir as colunas', () => {
    expect(formatReportCount(0)).toBe('0');
    expect(formatReportCount(5000)).toBe('5 000');
    expect(formatReportCount(12_500)).toBe('12 500');
  });

  it('gera um código de relatório estável e alfanumérico', () => {
    const generatedAt = new Date('2026-11-18T10:00:00Z');
    const code = reportDocumentCode('host-1', generatedAt);

    expect(code).toMatch(/^CC-REL-20261118-[A-Z0-9]{4}$/);
    expect(reportDocumentCode('host-1', generatedAt)).toBe(code);
    expect(reportDocumentCode('host-2', generatedAt)).not.toBe(code);
  });

  it('calcula a taxa de resposta e valida a soma por linha', () => {
    const counts = { totalInvitations: 12, accepted: 6, pending: 5, declined: 1 };

    expect(reportResponseRate(counts)).toBeCloseTo(7 / 12);
    expect(reportResponseRate({ ...counts, totalInvitations: 0 })).toBe(0);
    expect(reportRowIsConsistent(counts)).toBe(true);
    expect(reportRowIsConsistent({ ...counts, totalInvitations: 13 })).toBe(false);
  });
});
