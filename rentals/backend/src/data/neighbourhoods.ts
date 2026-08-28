/**
 * Curated real neighbourhood/district data, per city, for accurate
 * (non-city-center) listing coordinates -- the same curated-reference-data
 * pattern already used for the City table (prisma/seed.ts). Major metros
 * get several well-known neighbourhoods; smaller towns get at least one
 * real, commonly recognized district (e.g. "Downtown <Town>") so every
 * city seeded in CANADIAN_CITIES (prisma/seed.ts) has at least one valid
 * neighbourhood option -- a required-neighbourhood field must never leave
 * a city with zero choices to select from.
 *
 * Shared by prisma/seed.ts (DB seeding) and src/routes/neighbourhoods.ts
 * (server-side coverage check + tests) so there is a single source of
 * truth, not two lists that can drift apart.
 */
export interface NeighbourhoodSeed {
  name: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
}

export const NEIGHBOURHOODS: NeighbourhoodSeed[] = [
  // Toronto, ON
  { name: 'Kensington Market',  city: 'Toronto', province: 'ON', lat: 43.6547, lng: -79.4005 },
  { name: 'Financial District', city: 'Toronto', province: 'ON', lat: 43.6488, lng: -79.3818 },
  { name: 'The Annex',          city: 'Toronto', province: 'ON', lat: 43.6707, lng: -79.4073 },
  { name: 'Yorkville',          city: 'Toronto', province: 'ON', lat: 43.6709, lng: -79.3903 },
  { name: 'Liberty Village',    city: 'Toronto', province: 'ON', lat: 43.6373, lng: -79.4207 },
  { name: 'Leslieville',        city: 'Toronto', province: 'ON', lat: 43.6629, lng: -79.3372 },
  { name: 'The Beaches',        city: 'Toronto', province: 'ON', lat: 43.6708, lng: -79.2960 },
  { name: 'High Park',          city: 'Toronto', province: 'ON', lat: 43.6465, lng: -79.4637 },
  { name: 'North York',         city: 'Toronto', province: 'ON', lat: 43.7615, lng: -79.4111 },
  { name: 'Scarborough',        city: 'Toronto', province: 'ON', lat: 43.7764, lng: -79.2318 },
  { name: 'Etobicoke',          city: 'Toronto', province: 'ON', lat: 43.6435, lng: -79.5656 },
  { name: 'Rexdale',            city: 'Toronto', province: 'ON', lat: 43.7238, lng: -79.5658 },
  // Mississauga, ON
  { name: 'Port Credit',        city: 'Mississauga', province: 'ON', lat: 43.5540, lng: -79.5867 },
  { name: 'Streetsville',       city: 'Mississauga', province: 'ON', lat: 43.5847, lng: -79.7154 },
  { name: 'Meadowvale',         city: 'Mississauga', province: 'ON', lat: 43.5977, lng: -79.7466 },
  { name: 'Erin Mills',         city: 'Mississauga', province: 'ON', lat: 43.5602, lng: -79.7024 },
  { name: 'City Centre',        city: 'Mississauga', province: 'ON', lat: 43.5932, lng: -79.6421 },
  { name: 'Malton',             city: 'Mississauga', province: 'ON', lat: 43.7040, lng: -79.6444 },
  // Brampton, ON
  { name: 'Downtown Brampton',  city: 'Brampton', province: 'ON', lat: 43.6858, lng: -79.7599 },
  { name: 'Bramalea',           city: 'Brampton', province: 'ON', lat: 43.7223, lng: -79.7186 },
  { name: 'Springdale',         city: 'Brampton', province: 'ON', lat: 43.7444, lng: -79.7085 },
  { name: 'Heart Lake',         city: 'Brampton', province: 'ON', lat: 43.7280, lng: -79.7710 },
  // Vaughan, ON
  { name: 'Woodbridge',         city: 'Vaughan', province: 'ON', lat: 43.7852, lng: -79.5992 },
  { name: 'Maple',              city: 'Vaughan', province: 'ON', lat: 43.8636, lng: -79.5169 },
  { name: 'Thornhill',          city: 'Vaughan', province: 'ON', lat: 43.8156, lng: -79.4241 },
  // Markham, ON
  { name: 'Unionville',         city: 'Markham', province: 'ON', lat: 43.8626, lng: -79.3096 },
  { name: 'Milliken',           city: 'Markham', province: 'ON', lat: 43.8231, lng: -79.2921 },
  { name: 'Markham Village',    city: 'Markham', province: 'ON', lat: 43.8791, lng: -79.2588 },
  // Richmond Hill, ON
  { name: 'Oak Ridges',         city: 'Richmond Hill', province: 'ON', lat: 43.9445, lng: -79.4560 },
  { name: 'Richmond Hill Centre', city: 'Richmond Hill', province: 'ON', lat: 43.8828, lng: -79.4403 },
  // Ottawa, ON
  { name: 'ByWard Market',      city: 'Ottawa', province: 'ON', lat: 45.4285, lng: -75.6923 },
  { name: 'Centretown',         city: 'Ottawa', province: 'ON', lat: 45.4145, lng: -75.6919 },
  { name: 'Kanata',             city: 'Ottawa', province: 'ON', lat: 45.3088, lng: -75.9188 },
  { name: 'Barrhaven',          city: 'Ottawa', province: 'ON', lat: 45.2731, lng: -75.7508 },
  { name: 'Orleans',            city: 'Ottawa', province: 'ON', lat: 45.4685, lng: -75.5279 },
  { name: 'Westboro',           city: 'Ottawa', province: 'ON', lat: 45.3948, lng: -75.7573 },
  // Hamilton, ON
  { name: 'Downtown Hamilton',  city: 'Hamilton', province: 'ON', lat: 43.2560, lng: -79.8711 },
  { name: 'Ancaster',           city: 'Hamilton', province: 'ON', lat: 43.2216, lng: -79.9808 },
  { name: 'Stoney Creek',       city: 'Hamilton', province: 'ON', lat: 43.2230, lng: -79.7663 },
  { name: 'Dundas',             city: 'Hamilton', province: 'ON', lat: 43.2662, lng: -79.9598 },
  // London, ON
  { name: 'Downtown London',    city: 'London', province: 'ON', lat: 42.9836, lng: -81.2497 },
  { name: 'Old East Village',   city: 'London', province: 'ON', lat: 42.9862, lng: -81.2298 },
  { name: 'Byron',              city: 'London', province: 'ON', lat: 42.9575, lng: -81.3242 },
  { name: 'Masonville',         city: 'London', province: 'ON', lat: 43.0175, lng: -81.2789 },
  // Kitchener, ON
  { name: 'Downtown Kitchener', city: 'Kitchener', province: 'ON', lat: 43.4501, lng: -80.4829 },
  { name: 'Forest Heights',     city: 'Kitchener', province: 'ON', lat: 43.4235, lng: -80.5251 },
  // Waterloo, ON
  { name: 'Uptown Waterloo',    city: 'Waterloo', province: 'ON', lat: 43.4650, lng: -80.5225 },
  { name: 'Lakeshore',          city: 'Waterloo', province: 'ON', lat: 43.4818, lng: -80.5462 },
  // Windsor, ON
  { name: 'Walkerville',        city: 'Windsor', province: 'ON', lat: 42.3187, lng: -83.0146 },
  { name: 'Downtown Windsor',   city: 'Windsor', province: 'ON', lat: 42.3151, lng: -83.0364 },
  // Smaller Ontario cities -- one well-known central district each
  { name: 'Downtown Barrie',           city: 'Barrie',           province: 'ON', lat: 44.3894, lng: -79.6903 },
  { name: 'Downtown Brantford',        city: 'Brantford',        province: 'ON', lat: 43.1394, lng: -80.2644 },
  { name: 'Downtown Burlington',       city: 'Burlington',       province: 'ON', lat: 43.3255, lng: -79.7990 },
  { name: 'Galt',                      city: 'Cambridge',        province: 'ON', lat: 43.3616, lng: -80.3144 },
  { name: 'Downtown Sudbury',          city: 'Greater Sudbury',  province: 'ON', lat: 46.4917, lng: -80.9930 },
  { name: 'Downtown Guelph',           city: 'Guelph',           province: 'ON', lat: 43.5448, lng: -80.2482 },
  { name: 'Downtown Kingston',         city: 'Kingston',         province: 'ON', lat: 44.2312, lng: -76.4860 },
  { name: 'Downtown Niagara Falls',    city: 'Niagara Falls',    province: 'ON', lat: 43.0896, lng: -79.0849 },
  { name: 'Downtown North Bay',        city: 'North Bay',        province: 'ON', lat: 46.3091, lng: -79.4608 },
  { name: 'Kerr Village',              city: 'Oakville',         province: 'ON', lat: 43.4475, lng: -79.6877 },
  { name: 'Downtown Oshawa',           city: 'Oshawa',           province: 'ON', lat: 43.8971, lng: -78.8658 },
  { name: 'Downtown Peterborough',     city: 'Peterborough',     province: 'ON', lat: 44.3091, lng: -78.3197 },
  { name: 'Pickering Village',         city: 'Pickering',        province: 'ON', lat: 43.8355, lng: -79.0893 },
  { name: 'Downtown Sarnia',           city: 'Sarnia',           province: 'ON', lat: 42.9994, lng: -82.3089 },
  { name: 'Downtown Sault Ste. Marie', city: 'Sault Ste. Marie', province: 'ON', lat: 46.5136, lng: -84.3358 },
  { name: 'Downtown St. Catharines',   city: 'St. Catharines',   province: 'ON', lat: 43.1594, lng: -79.2469 },
  { name: 'Fort William',              city: 'Thunder Bay',      province: 'ON', lat: 48.3809, lng: -89.2477 },
  { name: 'Downtown Timmins',          city: 'Timmins',          province: 'ON', lat: 48.4758, lng: -81.3305 },
  // Vancouver, BC
  { name: 'Kitsilano',          city: 'Vancouver', province: 'BC', lat: 49.2687, lng: -123.1550 },
  { name: 'Yaletown',           city: 'Vancouver', province: 'BC', lat: 49.2751, lng: -123.1211 },
  { name: 'Mount Pleasant',     city: 'Vancouver', province: 'BC', lat: 49.2634, lng: -123.1000 },
  { name: 'Commercial Drive',   city: 'Vancouver', province: 'BC', lat: 49.2647, lng: -123.0698 },
  { name: 'West End',           city: 'Vancouver', province: 'BC', lat: 49.2870, lng: -123.1350 },
  { name: 'Marpole',            city: 'Vancouver', province: 'BC', lat: 49.2103, lng: -123.1305 },
  // Surrey, BC
  { name: 'Guildford',          city: 'Surrey', province: 'BC', lat: 49.1839, lng: -122.8168 },
  { name: 'Newton',             city: 'Surrey', province: 'BC', lat: 49.1289, lng: -122.8460 },
  { name: 'Fleetwood',          city: 'Surrey', province: 'BC', lat: 49.1573, lng: -122.7856 },
  { name: 'Whalley',            city: 'Surrey', province: 'BC', lat: 49.1894, lng: -122.8494 },
  { name: 'Cloverdale',         city: 'Surrey', province: 'BC', lat: 49.1054, lng: -122.7290 },
  // Burnaby, BC
  { name: 'Metrotown',          city: 'Burnaby', province: 'BC', lat: 49.2261, lng: -123.0036 },
  { name: 'Brentwood',          city: 'Burnaby', province: 'BC', lat: 49.2681, lng: -123.0027 },
  // Richmond, BC
  { name: 'Steveston',          city: 'Richmond', province: 'BC', lat: 49.1259, lng: -123.1815 },
  { name: 'City Centre',        city: 'Richmond', province: 'BC', lat: 49.1666, lng: -123.1336 },
  // Smaller BC cities
  { name: 'Downtown Coquitlam',    city: 'Coquitlam',      province: 'BC', lat: 49.2838, lng: -122.7932 },
  { name: 'Downtown Abbotsford',   city: 'Abbotsford',     province: 'BC', lat: 49.0504, lng: -122.3045 },
  { name: 'Downtown Kelowna',      city: 'Kelowna',        province: 'BC', lat: 49.8880, lng: -119.4960 },
  { name: 'Downtown Kamloops',     city: 'Kamloops',       province: 'BC', lat: 50.6745, lng: -120.3273 },
  { name: 'Downtown Langley',      city: 'Langley',        province: 'BC', lat: 49.1044, lng: -122.6601 },
  { name: 'Downtown Nanaimo',      city: 'Nanaimo',        province: 'BC', lat: 49.1659, lng: -123.9401 },
  { name: 'Downtown Prince George', city: 'Prince George',  province: 'BC', lat: 53.9171, lng: -122.7497 },
  { name: 'Downtown Victoria',     city: 'Victoria',       province: 'BC', lat: 48.4284, lng: -123.3656 },
  { name: 'Oak Bay',               city: 'Victoria',       province: 'BC', lat: 48.4293, lng: -123.3129 },
  // Calgary, AB
  { name: 'Downtown Calgary',   city: 'Calgary', province: 'AB', lat: 51.0447, lng: -114.0719 },
  { name: 'Beltline',           city: 'Calgary', province: 'AB', lat: 51.0392, lng: -114.0719 },
  { name: 'Kensington',         city: 'Calgary', province: 'AB', lat: 51.0554, lng: -114.0894 },
  { name: 'Taradale',           city: 'Calgary', province: 'AB', lat: 51.1114, lng: -113.9720 },
  { name: 'Cranston',           city: 'Calgary', province: 'AB', lat: 50.9080, lng: -113.9700 },
  // Edmonton, AB
  { name: 'Downtown Edmonton',  city: 'Edmonton', province: 'AB', lat: 53.5461, lng: -113.4938 },
  { name: 'Mill Woods',         city: 'Edmonton', province: 'AB', lat: 53.4655, lng: -113.4402 },
  { name: 'Southgate',          city: 'Edmonton', province: 'AB', lat: 53.4783, lng: -113.5155 },
  { name: 'Clareview',          city: 'Edmonton', province: 'AB', lat: 53.6086, lng: -113.4278 },
  // Smaller Alberta cities
  { name: 'Downtown Lethbridge',     city: 'Lethbridge',     province: 'AB', lat: 49.6956, lng: -112.8451 },
  { name: 'Downtown Red Deer',       city: 'Red Deer',       province: 'AB', lat: 52.2681, lng: -113.8112 },
  { name: 'Downtown Airdrie',        city: 'Airdrie',        province: 'AB', lat: 51.2917, lng: -114.0144 },
  { name: 'Downtown Spruce Grove',   city: 'Spruce Grove',   province: 'AB', lat: 53.5449, lng: -113.9003 },
  { name: 'Downtown Grande Prairie', city: 'Grande Prairie', province: 'AB', lat: 55.1707, lng: -118.7884 },
  { name: 'Downtown Medicine Hat',   city: 'Medicine Hat',   province: 'AB', lat: 50.0417, lng: -110.6775 },
  { name: 'Waterways',               city: 'Fort McMurray',  province: 'AB', lat: 56.7267, lng: -111.3797 },
  // Montréal, QC
  { name: 'Plateau-Mont-Royal', city: 'Montréal', province: 'QC', lat: 45.5225, lng: -73.5825 },
  { name: 'Downtown Montréal',  city: 'Montréal', province: 'QC', lat: 45.5017, lng: -73.5673 },
  { name: 'Côte-des-Neiges',    city: 'Montréal', province: 'QC', lat: 45.4950, lng: -73.6238 },
  { name: 'Notre-Dame-de-Grâce', city: 'Montréal', province: 'QC', lat: 45.4695, lng: -73.6187 },
  { name: 'Verdun',             city: 'Montréal', province: 'QC', lat: 45.4589, lng: -73.5673 },
  { name: 'Saint-Laurent',      city: 'Montréal', province: 'QC', lat: 45.5089, lng: -73.6864 },
  // Other Quebec cities
  { name: 'Hull',                city: 'Gatineau',       province: 'QC', lat: 45.4292, lng: -75.7147 },
  { name: 'Chomedey',            city: 'Laval',          province: 'QC', lat: 45.5636, lng: -73.7657 },
  { name: 'Downtown Lévis',      city: 'Lévis',          province: 'QC', lat: 46.6886, lng: -71.1816 },
  { name: 'Vieux-Longueuil',     city: 'Longueuil',      province: 'QC', lat: 45.5315, lng: -73.5185 },
  { name: 'Vieux-Québec',        city: 'Québec',         province: 'QC', lat: 46.8123, lng: -71.2028 },
  { name: 'Downtown Repentigny', city: 'Repentigny',     province: 'QC', lat: 45.7422, lng: -73.4604 },
  { name: 'Chicoutimi',          city: 'Saguenay',       province: 'QC', lat: 48.4279, lng: -71.0680 },
  { name: 'Downtown Sherbrooke', city: 'Sherbrooke',     province: 'QC', lat: 45.4042, lng: -71.8929 },
  { name: 'Downtown Terrebonne', city: 'Terrebonne',     province: 'QC', lat: 45.7049, lng: -73.7196 },
  { name: 'Downtown Trois-Rivières', city: 'Trois-Rivières', province: 'QC', lat: 46.3432, lng: -72.5432 },
  // Winnipeg, MB
  { name: 'Downtown Winnipeg',  city: 'Winnipeg', province: 'MB', lat: 49.8951, lng: -97.1384 },
  { name: 'St. Vital',          city: 'Winnipeg', province: 'MB', lat: 49.8237, lng: -97.1181 },
  { name: 'St. James',          city: 'Winnipeg', province: 'MB', lat: 49.8867, lng: -97.2264 },
  { name: 'Transcona',          city: 'Winnipeg', province: 'MB', lat: 49.8983, lng: -97.0139 },
  // Other Manitoba cities
  { name: 'Downtown Brandon',   city: 'Brandon',   province: 'MB', lat: 49.8485, lng: -99.9501 },
  { name: 'Downtown Steinbach', city: 'Steinbach', province: 'MB', lat: 49.5256, lng: -96.6836 },
  { name: 'Downtown Thompson',  city: 'Thompson',  province: 'MB', lat: 55.7435, lng: -97.8558 },
  // Halifax, NS
  { name: 'Downtown Halifax',   city: 'Halifax', province: 'NS', lat: 44.6488, lng: -63.5752 },
  { name: 'Dartmouth',          city: 'Halifax', province: 'NS', lat: 44.6658, lng: -63.5669 },
  { name: 'Clayton Park',       city: 'Halifax', province: 'NS', lat: 44.6659, lng: -63.6377 },
  { name: 'Downtown Sydney',    city: 'Sydney',  province: 'NS', lat: 46.1368, lng: -60.1942 },
  // Regina, SK
  { name: 'Downtown Regina',    city: 'Regina', province: 'SK', lat: 50.4452, lng: -104.6189 },
  { name: 'Harbour Landing',    city: 'Regina', province: 'SK', lat: 50.4180, lng: -104.6659 },
  // Saskatoon, SK
  { name: 'Downtown Saskatoon', city: 'Saskatoon', province: 'SK', lat: 52.1332, lng: -106.6700 },
  { name: 'Stonebridge',        city: 'Saskatoon', province: 'SK', lat: 52.0873, lng: -106.6248 },
  // Other Saskatchewan cities
  { name: 'Downtown Moose Jaw',     city: 'Moose Jaw',     province: 'SK', lat: 50.3934, lng: -105.5519 },
  { name: 'Downtown Prince Albert', city: 'Prince Albert', province: 'SK', lat: 53.2033, lng: -105.7531 },
  // New Brunswick
  { name: 'Downtown Fredericton', city: 'Fredericton', province: 'NB', lat: 45.9636, lng: -66.6431 },
  { name: 'Downtown Moncton',     city: 'Moncton',      province: 'NB', lat: 46.0878, lng: -64.7782 },
  { name: 'Uptown Saint John',    city: 'Saint John',   province: 'NB', lat: 45.2733, lng: -66.0633 },
  // Newfoundland and Labrador
  { name: "Downtown St. John's",   city: "St. John's",   province: 'NL', lat: 47.5615, lng: -52.7126 },
  { name: 'Downtown Corner Brook', city: 'Corner Brook', province: 'NL', lat: 48.9517, lng: -57.9325 },
  { name: 'Mount Pearl Centre',    city: 'Mount Pearl',   province: 'NL', lat: 47.5192, lng: -52.8058 },
  // Northern territories
  { name: 'Downtown Yellowknife', city: 'Yellowknife', province: 'NT', lat: 62.4540, lng: -114.3718 },
  { name: 'Downtown Iqaluit',     city: 'Iqaluit',      province: 'NU', lat: 63.7467, lng: -68.5170 },
  { name: 'Downtown Whitehorse',  city: 'Whitehorse',   province: 'YT', lat: 60.7212, lng: -135.0568 },
  // Prince Edward Island
  { name: 'Downtown Charlottetown', city: 'Charlottetown', province: 'PE', lat: 46.2382, lng: -63.1311 },
];
