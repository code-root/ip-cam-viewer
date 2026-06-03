-- CreateTable
CREATE TABLE "GlobalFaceFingerprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "globalTrackId" TEXT NOT NULL,
    "globalTrackNum" INTEGER NOT NULL,
    "descriptor" TEXT NOT NULL,
    "employeeId" TEXT,
    "camerasVisited" TEXT NOT NULL DEFAULT '[]',
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "lastCameraId" TEXT,
    "lastSeenAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GlobalFaceFingerprint_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalFaceFingerprint_globalTrackId_key" ON "GlobalFaceFingerprint"("globalTrackId");
