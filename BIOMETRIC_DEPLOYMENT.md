# AssetFlow biometric + access-control deployment

## Cloud
1. Deploy the changed backend and frontend files.
2. In `backend`, run `npm install`, `npx prisma generate`, then `npx prisma migrate deploy`.
3. Restart the Node API.
4. Open AssetFlow as ADMIN/CEO and go to Settings → Attendance Devices.

## Customer site
1. Install Node.js 20 LTS on a Windows PC that can reach the biometric device.
2. Copy the `connector` folder.
3. `cd connector && npm install`.
4. If the customer uses a ZKTeco pull-mode device, run `npm install node-zklib`. ZKTeco's legacy network integrations commonly use port 4370; community Node clients expose attendance/user/info operations over that protocol. citeturn0search1turn0search2
5. Copy `.env.example` to `.env`, set `ASSETFLOW_API_URL` and the connector token.
6. Run `npm start`.
7. For production, install the connector as a Windows Service or Task Scheduler job so it starts automatically.

## Multi-company
Every connector token is hashed and belongs to exactly one `BiometricDevice`, which belongs to one `Organization`. Connector ingestion never accepts an organization id from the customer; the server derives the organization from the authenticated device token.

## Push devices
If a vendor/device supports HTTPS push, use `connectionMode=PUSH` and add a vendor adapter or configure the vendor gateway to forward normalized punches to `/api/biometric/connector/punches`. ZKTeco publishes a PUSH SDK and documents HTTP/HTTPS push integrations. citeturn0search0turn0search15

## Door access
AssetFlow records the successful biometric punch. Physical door unlocking must be executed by the local biometric terminal/access controller/relay. A device must expose a supported relay/control interface; attendance-only terminals cannot be made into door controllers by software alone. Configure `doorEnabled` and `unlockSeconds`, then implement the vendor/relay adapter for the customer's access controller.
