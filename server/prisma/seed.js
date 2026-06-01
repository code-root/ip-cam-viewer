import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();
async function main() {
    const adminHash = await bcrypt.hash('admin123', 10);
    await prisma.user.upsert({
        where: { username: 'admin' },
        create: { username: 'admin', passwordHash: adminHash, role: 'admin' },
        update: {},
    });
    const opHash = await bcrypt.hash('operator123', 10);
    await prisma.user.upsert({
        where: { username: 'operator' },
        create: { username: 'operator', passwordHash: opHash, role: 'operator' },
        update: {},
    });
    const viewerHash = await bcrypt.hash('viewer123', 10);
    await prisma.user.upsert({
        where: { username: 'viewer' },
        create: { username: 'viewer', passwordHash: viewerHash, role: 'viewer' },
        update: {},
    });
    console.log('Seeded users: admin/admin123, operator/operator123, viewer/viewer123');
}
main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
