
export const locationData: Record<
  string,
  Record<string, string[]>
> = {
  Dhaka: {
    Mirpur: [
      'Mirpur-1',
      'Mirpur-2',
      'Mirpur-10',
      'Mirpur-11',
      'Pallabi',
    ],
    Uttara: [
      'Sector 1',
      'Sector 4',
      'Sector 7',
      'Sector 10',
    ],
    Dhanmondi: [
      'Dhanmondi 2',
      'Dhanmondi 8',
      'Dhanmondi 27',
    ],
  },

  Chattogram: {
    Panchlaish: [
      'Sholoshahar',
      'Muradpur',
    ],
    Kotwali: [
      'Anderkilla',
      'New Market',
    ],
  },

  Gazipur: {
    'Gazipur Sadar': [
      'Joydebpur',
      'Chandana Chowrasta',
    ],
    Tongi: [
      'Tongi Bazar',
      'Station Road',
    ],
  },
};

// Return all district names
export const getDistricts = (): string[] => {
  return Object.keys(locationData);
};

// Return areas under the selected district
export const getThanas = (district: string): string[] => {
  return Object.keys(locationData[district] ?? {});
};

// Return local areas under selected district and thana
export const getLocalAreas = (
  district: string,
  thana: string
): string[] => {
  return locationData[district]?.[thana] ?? [];
};
