/**
 * Database seeder — cities and neighbourhoods.
 * Mosque seeding has been removed as the mosque feature is no longer part of the platform.
 */
import { PrismaClient } from '@prisma/client';
import { CANADIAN_CITIES } from '../src/data/cities';
import { NEIGHBOURHOODS } from '../src/data/neighbourhoods';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  console.log('🏙️ Seeding cities...');
  for (const city of CANADIAN_CITIES) {
    await prisma.city.upsert({
      where:  { name_province: { name: city.name, province: city.province } },
      update: {},
      create: city,
    });
  }
  console.log(`✅ Seeded ${CANADIAN_CITIES.length} cities`);

  console.log('🏘️ Seeding neighbourhoods...');
  for (const n of NEIGHBOURHOODS) {
    await prisma.neighbourhood.upsert({
      where:  { city_province_name: { city: n.city, province: n.province, name: n.name } },
      update: {},
      create: n,
    });
  }
  console.log(`✅ Seeded ${NEIGHBOURHOODS.length} neighbourhoods`);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
