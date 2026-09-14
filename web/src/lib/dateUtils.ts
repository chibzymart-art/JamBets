/**
 * Date utilities for Oddsbanta predictions
 * Centralized WAT (Africa/Lagos) formatting for deterministic calendar ribbons
 */

export const getTodayIsoDate = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

export const getYesterdayIsoDate = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Date.now() - 86400000));
};

export const getTomorrowIsoDate = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Date.now() + 86400000));
};
