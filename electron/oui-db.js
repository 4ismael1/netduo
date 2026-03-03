/**
 * IEEE OUI → Vendor lookup — Extended database (~600 entries)
 * Covers top consumer, enterprise, IoT vendors.
 * Key = first 3 octets uppercase with colons, Value = vendor name.
 */

const OUI = {
  // ── Apple ──
  '00:03:93':'Apple','00:0A:95':'Apple','00:0D:93':'Apple','00:1C:B3':'Apple','00:1E:C2':'Apple',
  '00:25:00':'Apple','00:26:08':'Apple','00:26:B0':'Apple','04:0C:CE':'Apple','04:15:52':'Apple',
  '04:26:65':'Apple','04:48:9A':'Apple','04:F1:28':'Apple','08:66:98':'Apple','0C:74:C2':'Apple',
  '10:40:F3':'Apple','10:DD:B1':'Apple','14:10:9F':'Apple','14:7D:DA':'Apple','14:99:E2':'Apple',
  '18:34:51':'Apple','18:AF:61':'Apple','1C:36:BB':'Apple','1C:91:80':'Apple','20:78:F0':'Apple',
  '24:A0:74':'Apple','28:6A:BA':'Apple','28:CF:E9':'Apple','2C:BE:08':'Apple','30:35:AD':'Apple',
  '34:36:3B':'Apple','38:C9:86':'Apple','38:F9:D3':'Apple','3C:07:54':'Apple','3C:15:C2':'Apple',
  '3C:22:FB':'Apple','40:33:1A':'Apple','40:A6:D9':'Apple','44:2A:60':'Apple','48:60:BC':'Apple',
  '4C:32:75':'Apple','4C:57:CA':'Apple','50:32:37':'Apple','54:26:96':'Apple','54:72:4F':'Apple',
  '58:55:CA':'Apple','5C:F7:E6':'Apple','60:03:08':'Apple','60:FE:C5':'Apple','64:A5:C3':'Apple',
  '68:5B:35':'Apple','6C:40:08':'Apple','6C:70:9F':'Apple','70:56:81':'Apple','70:CD:60':'Apple',
  '74:E2:F5':'Apple','78:31:C1':'Apple','78:7B:8A':'Apple','7C:D1:C3':'Apple','80:E6:50':'Apple',
  '84:38:35':'Apple','84:78:8B':'Apple','84:FC:FE':'Apple','88:66:A5':'Apple','88:E9:FE':'Apple',
  '8C:7C:92':'Apple','90:72:40':'Apple','90:8D:6C':'Apple','98:01:A7':'Apple',
  '98:D6:BB':'Apple','9C:20:7B':'Apple','9C:F3:87':'Apple','A0:99:9B':'Apple',
  'A4:C3:61':'Apple','A4:D1:8C':'Apple','A8:5C:2C':'Apple','A8:60:B6':'Apple',
  'AC:29:3A':'Apple','AC:BC:32':'Apple','AC:DE:48':'Apple','B0:65:BD':'Apple','B0:70:2D':'Apple',
  'B4:18:D1':'Apple','B8:17:C2':'Apple','B8:53:AC':'Apple','B8:C1:11':'Apple','B8:E8:56':'Apple',
  'BC:52:B7':'Apple','BC:67:78':'Apple','C0:63:94':'Apple','C0:CE:CD':'Apple','C4:2C:03':'Apple',
  'C8:2A:14':'Apple','CC:08:8D':'Apple','CC:20:E8':'Apple','CC:44:63':'Apple','D0:03:4B':'Apple',
  'D0:25:98':'Apple','D0:33:11':'Apple','D4:61:9D':'Apple','D4:F4:6F':'Apple','D8:1D:72':'Apple',
  'D8:96:95':'Apple','DC:2B:2A':'Apple','DC:56:E7':'Apple','DC:A4:CA':'Apple','DC:A9:04':'Apple',
  'E0:5F:45':'Apple','E0:AC:CB':'Apple','E0:B5:5F':'Apple','E0:C7:67':'Apple','E4:25:E7':'Apple',
  'E4:CE:8F':'Apple','E8:06:88':'Apple','E8:80:2E':'Apple','EC:85:2F':'Apple','F0:18:98':'Apple',
  'F0:72:EA':'Apple','F0:99:BF':'Apple','F0:B4:79':'Apple','F0:C1:F1':'Apple','F0:CB:A1':'Apple',
  'F4:1B:A1':'Apple','F4:5C:89':'Apple','F8:27:93':'Apple','F8:38:80':'Apple','F8:E9:4E':'Apple',

  // ── Samsung ──
  '00:07:AB':'Samsung','00:12:47':'Samsung','00:15:99':'Samsung','00:16:6B':'Samsung','00:16:DB':'Samsung',
  '00:1A:8A':'Samsung','00:21:19':'Samsung','00:23:39':'Samsung','00:24:54':'Samsung','00:26:37':'Samsung',
  '08:37:3D':'Samsung','08:D4:2B':'Samsung','0C:14:20':'Samsung','10:30:47':'Samsung','14:49:E0':'Samsung',
  '18:67:B0':'Samsung','18:83:31':'Samsung','1C:62:B8':'Samsung','20:D3:90':'Samsung','24:4B:81':'Samsung',
  '28:98:7B':'Samsung','2C:AE:2B':'Samsung','30:CD:A7':'Samsung','34:14:5F':'Samsung','34:C3:AC':'Samsung',
  '38:01:97':'Samsung','3C:5A:37':'Samsung','3C:62:00':'Samsung','40:16:3B':'Samsung','44:4E:1A':'Samsung',
  '44:F4:59':'Samsung','48:44:F7':'Samsung','4C:BC:98':'Samsung','50:01:BB':'Samsung','50:B7:C3':'Samsung',
  '54:40:AD':'Samsung','54:92:BE':'Samsung','58:C3:8B':'Samsung','5C:3C:27':'Samsung','5C:E8:EB':'Samsung',
  '60:6B:BD':'Samsung','64:B8:53':'Samsung','68:27:37':'Samsung','6C:F3:73':'Samsung','70:2A:D5':'Samsung',
  '74:45:CE':'Samsung','78:1F:DB':'Samsung','78:47:1D':'Samsung','78:BD:BC':'Samsung','7C:0A:3F':'Samsung',
  '80:18:A7':'Samsung','84:25:DB':'Samsung','84:38:38':'Samsung','88:32:9B':'Samsung','8C:77:12':'Samsung',
  '90:18:7C':'Samsung','94:01:C2':'Samsung','94:35:0A':'Samsung','98:52:3D':'Samsung','9C:02:98':'Samsung',
  'A0:82:1F':'Samsung','A4:F2:74':'Samsung','A8:06:00':'Samsung','A8:F2:74':'Samsung','AC:36:13':'Samsung',
  'AC:5F:3E':'Samsung','B0:47:BF':'Samsung','B0:72:BF':'Samsung','B4:3A:28':'Samsung','B8:5E:7B':'Samsung',
  'BC:14:EF':'Samsung','BC:72:B1':'Samsung','C0:BD:D1':'Samsung','C4:73:1E':'Samsung','C8:14:79':'Samsung',
  'CC:07:AB':'Samsung','D0:17:6A':'Samsung','D0:22:BE':'Samsung','D0:87:E2':'Samsung','D4:88:90':'Samsung',
  'D8:57:EF':'Samsung','DC:CF:96':'Samsung','E4:12:1D':'Samsung','E4:7C:F9':'Samsung','E8:3A:12':'Samsung',
  'EC:1F:72':'Samsung','F0:5B:7B':'Samsung','F4:7B:5E':'Samsung','F8:04:2E':'Samsung','FC:A1:3E':'Samsung',

  // ── Google ──
  '30:FD:38':'Google','3C:5A:B4':'Google','48:D6:D5':'Google','54:60:09':'Google',
  '94:EB:2C':'Google','A4:77:33':'Google','F8:0F:F9':'Google',

  // ── Xiaomi ──
  '04:CF:8C':'Xiaomi','0C:1D:AF':'Xiaomi','10:2A:B3':'Xiaomi','14:F6:5A':'Xiaomi','18:59:36':'Xiaomi',
  '20:34:FB':'Xiaomi','28:6C:07':'Xiaomi','2C:28:B7':'Xiaomi','34:80:B3':'Xiaomi','38:A4:ED':'Xiaomi',
  '3C:BD:3E':'Xiaomi','44:23:7C':'Xiaomi','4C:49:E3':'Xiaomi','50:64:2B':'Xiaomi','58:44:98':'Xiaomi',
  '5C:AF:06':'Xiaomi','60:AB:67':'Xiaomi','64:CC:2E':'Xiaomi','68:AB:1E':'Xiaomi','6C:5A:B0':'Xiaomi',
  '74:23:44':'Xiaomi','78:02:F8':'Xiaomi','78:11:DC':'Xiaomi','7C:1C:4E':'Xiaomi','80:AD:16':'Xiaomi',
  '88:C3:97':'Xiaomi','8C:DE:F9':'Xiaomi','94:E9:79':'Xiaomi','98:FA:E3':'Xiaomi',
  '9C:9D:7E':'Xiaomi','A8:9C:ED':'Xiaomi','AC:C1:EE':'Xiaomi','B0:E2:35':'Xiaomi',
  'B4:0B:44':'Xiaomi','C4:0B:CB':'Xiaomi','C8:58:C0':'Xiaomi','D4:61:DA':'Xiaomi','DC:D8:7C':'Xiaomi',
  'E4:CA:12':'Xiaomi','F0:B4:29':'Xiaomi','F4:8B:32':'Xiaomi','FC:64:BA':'Xiaomi',

  // ── Intel ──
  '00:02:B3':'Intel','00:03:47':'Intel','00:04:23':'Intel','00:0E:0C':'Intel','00:0E:35':'Intel',
  '00:13:02':'Intel','00:13:20':'Intel','00:15:00':'Intel','00:16:6F':'Intel','00:16:76':'Intel',
  '00:1B:21':'Intel','00:1C:BF':'Intel','00:1D:E0':'Intel','00:1E:64':'Intel','00:1E:65':'Intel',
  '00:1F:3B':'Intel','00:1F:3C':'Intel','00:22:FA':'Intel','00:24:D6':'Intel','00:27:10':'Intel',
  '18:1D:EA':'Intel','24:77:03':'Intel','34:02:86':'Intel','34:13:E8':'Intel','3C:97:0E':'Intel',
  '40:A6:B7':'Intel','48:51:B7':'Intel','4C:34:88':'Intel','50:76:AF':'Intel','58:91:CF':'Intel',
  '5C:87:9C':'Intel','5C:C5:D4':'Intel','60:36:DD':'Intel','64:D4:DA':'Intel','68:05:CA':'Intel',
  '70:CF:49':'Intel','74:E6:E2':'Intel','7C:76:35':'Intel','80:86:F2':'Intel',
  '84:3A:4B':'Intel','88:78:73':'Intel','8C:8D:28':'Intel','90:61:AE':'Intel','94:65:9C':'Intel',
  '98:54:1B':'Intel','9C:DA:3E':'Intel','A0:36:9F':'Intel','A4:4C:C8':'Intel','A8:7E:EA':'Intel',
  'B4:96:91':'Intel','B8:08:CF':'Intel','C8:21:58':'Intel','D4:3B:04':'Intel','DC:1B:A1':'Intel',
  'F4:30:B9':'Intel','F4:8C:50':'Intel','F8:63:3F':'Intel',

  // ── TP-Link ──
  '00:1D:0F':'TP-Link','08:10:79':'TP-Link','10:FE:ED':'TP-Link','14:CC:20':'TP-Link','18:A6:F7':'TP-Link',
  '1C:3B:F3':'TP-Link','24:69:68':'TP-Link','30:B5:C2':'TP-Link','34:60:F9':'TP-Link','38:83:45':'TP-Link',
  '3C:46:D8':'TP-Link','40:ED:00':'TP-Link','44:32:C8':'TP-Link','48:22:54':'TP-Link',
  '54:A6:5E':'TP-Link','5C:A6:E6':'TP-Link','60:32:B1':'TP-Link','64:56:01':'TP-Link',
  '6C:5A:B5':'TP-Link','70:4F:57':'TP-Link','78:8C:B5':'TP-Link','7C:8B:CA':'TP-Link','84:16:F9':'TP-Link',
  '90:F6:52':'TP-Link','94:D9:B3':'TP-Link','98:DA:C4':'TP-Link','9C:A2:F4':'TP-Link','A0:F3:C1':'TP-Link',
  'A4:2B:B0':'TP-Link','A8:42:A1':'TP-Link','AC:84:C6':'TP-Link','B0:95:75':'TP-Link','B0:BE:76':'TP-Link',
  'B4:B0:24':'TP-Link','B8:27:C5':'TP-Link','C0:06:C3':'TP-Link','C4:E9:84':'TP-Link','C8:E7:D8':'TP-Link',
  'CC:B0:DA':'TP-Link','D4:6E:0E':'TP-Link','D8:07:B6':'TP-Link','D8:47:32':'TP-Link','E4:C3:2A':'TP-Link',
  'EC:08:6B':'TP-Link','F0:A7:31':'TP-Link','F4:EC:38':'TP-Link','F8:D1:11':'TP-Link',

  // ── Cisco / Meraki / Linksys ──
  '00:00:0C':'Cisco','00:01:42':'Cisco','00:01:63':'Cisco','00:01:64':'Cisco','00:01:96':'Cisco',
  '00:04:6D':'Cisco','00:05:9A':'Cisco','00:07:0D':'Cisco','00:07:0E':'Cisco','00:08:20':'Cisco',
  '00:0A:41':'Cisco','00:0B:45':'Cisco','00:0D:65':'Cisco','00:0E:83':'Cisco','00:12:43':'Cisco',
  '00:13:7F':'Cisco','00:16:46':'Cisco','00:17:94':'Cisco','00:1A:2F':'Cisco','00:1A:A1':'Cisco',
  '00:1B:0D':'Cisco','00:1B:53':'Cisco','00:1C:0E':'Cisco','00:1E:14':'Cisco','00:1E:49':'Cisco',
  '00:21:1B':'Cisco','00:22:55':'Cisco','00:23:04':'Cisco','00:23:BE':'Cisco','00:26:0A':'Cisco',
  '00:26:CB':'Cisco','00:27:0D':'Cisco','08:CC:68':'Cisco','0C:75:BD':'Cisco','18:33:9D':'Cisco',
  '20:3A:07':'Cisco','30:F7:0D':'Cisco','34:62:88':'Cisco','44:AD:D9':'Cisco','58:AC:78':'Cisco',
  '64:F6:9D':'Cisco','6C:41:6A':'Cisco','7C:21:0D':'Cisco','88:F0:31':'Cisco','B4:14:89':'Cisco',

  // ── ASUS ──
  '00:0C:6E':'ASUS','00:0E:A6':'ASUS','00:11:2F':'ASUS','00:15:F2':'ASUS','00:17:31':'ASUS',
  '00:1A:92':'ASUS','00:1D:60':'ASUS','00:1E:8C':'ASUS','00:22:15':'ASUS','00:23:54':'ASUS',
  '00:24:8C':'ASUS','00:26:18':'ASUS','04:92:26':'ASUS','08:60:6E':'ASUS','10:BF:48':'ASUS',
  '1C:87:2C':'ASUS','2C:4D:54':'ASUS','2C:56:DC':'ASUS','30:85:A9':'ASUS','34:97:F6':'ASUS',
  '38:D5:47':'ASUS','40:B0:76':'ASUS','48:5B:39':'ASUS','50:46:5D':'ASUS',
  '54:04:A6':'ASUS','60:45:CB':'ASUS','70:8B:CD':'ASUS','74:D0:2B':'ASUS',
  '88:D7:F6':'ASUS','90:E6:BA':'ASUS','A8:5E:45':'ASUS','AC:9E:17':'ASUS','B0:6E:BF':'ASUS',
  'BC:AE:C5':'ASUS','C8:60:00':'ASUS','D4:5D:64':'ASUS','E0:3F:49':'ASUS','F4:6D:04':'ASUS',

  // ── Netgear ──
  '00:09:5B':'Netgear','00:0F:B5':'Netgear','00:14:6C':'Netgear','00:1B:2F':'Netgear',
  '00:1E:2A':'Netgear','00:1F:33':'Netgear','00:22:3F':'Netgear','00:24:B2':'Netgear',
  '00:26:F2':'Netgear','04:A1:51':'Netgear','08:BD:43':'Netgear','10:0D:7F':'Netgear',
  '20:0C:C8':'Netgear','20:E5:2A':'Netgear','28:80:88':'Netgear','2C:B0:5D':'Netgear',
  '30:46:9A':'Netgear','38:94:ED':'Netgear','40:F4:EC':'Netgear','44:94:FC':'Netgear',
  '4C:60:DE':'Netgear','6C:B0:CE':'Netgear','84:1B:5E':'Netgear','9C:3D:CF':'Netgear',
  'A0:04:60':'Netgear','A0:21:B7':'Netgear','A4:2B:8C':'Netgear','B0:7F:B9':'Netgear',
  'B0:B9:8A':'Netgear','C4:04:15':'Netgear','C8:9E:43':'Netgear','CC:40:D0':'Netgear',
  'E0:91:F5':'Netgear','E4:F4:C6':'Netgear','E8:FC:AF':'Netgear',

  // ── Huawei / Honor ──
  '00:18:82':'Huawei','00:1E:10':'Huawei','00:25:9E':'Huawei','00:34:FE':'Huawei',
  '00:46:4B':'Huawei','00:66:4B':'Huawei','00:9A:CD':'Huawei','00:E0:FC':'Huawei',
  '04:B0:E7':'Huawei','08:19:A6':'Huawei','0C:37:DC':'Huawei',
  '10:44:00':'Huawei','10:47:80':'Huawei','14:B9:68':'Huawei','20:08:ED':'Huawei',
  '20:0B:C7':'Huawei','20:A6:80':'Huawei','24:09:95':'Huawei','24:1F:A0':'Huawei',
  '28:3C:E4':'Huawei','28:6E:D4':'Huawei','2C:9D:1E':'Huawei','30:D1:7E':'Huawei',
  '34:CD:BE':'Huawei','38:37:8B':'Huawei','3C:47:11':'Huawei','40:4D:8E':'Huawei',
  '44:55:B1':'Huawei','48:00:31':'Huawei','48:46:FB':'Huawei','48:AD:08':'Huawei',
  '48:DB:50':'Huawei','4C:54:99':'Huawei','4C:B1:6C':'Huawei','50:01:6B':'Huawei',
  '54:A5:1B':'Huawei','58:2A:F7':'Huawei','5C:09:79':'Huawei','60:DE:44':'Huawei',
  '70:72:3C':'Huawei','70:8A:09':'Huawei','74:88:2A':'Huawei','78:F5:57':'Huawei',
  '80:38:BC':'Huawei','80:B6:86':'Huawei','80:D0:9B':'Huawei','84:5B:12':'Huawei',
  '88:28:B3':'Huawei','88:3F:D3':'Huawei','8C:34:FD':'Huawei','8C:53:F7':'Huawei',
  '90:17:C8':'Huawei','94:04:9C':'Huawei','94:77:2B':'Huawei','98:E7:F5':'Huawei',
  'A4:99:47':'Huawei','AC:E8:7B':'Huawei','B0:E5:ED':'Huawei','C0:70:09':'Huawei',
  'CC:A2:23':'Huawei','D0:7A:B5':'Huawei','D4:6A:A8':'Huawei','D8:49:0B':'Huawei',
  'E0:24:7F':'Huawei','E4:68:A3':'Huawei','EC:23:3D':'Huawei',
  'F4:C7:14':'Huawei','FC:48:EF':'Huawei',

  // ── Microsoft / Xbox ──
  '00:03:FF':'Microsoft','00:0D:3A':'Microsoft','00:12:5A':'Microsoft',
  '00:17:FA':'Microsoft','00:1D:D8':'Microsoft','00:22:48':'Microsoft','00:25:AE':'Microsoft',
  '00:50:F2':'Microsoft','28:18:78':'Microsoft','48:50:73':'Microsoft','50:1A:C5':'Microsoft',
  '58:82:A8':'Microsoft','60:45:BD':'Microsoft','7C:1E:52':'Microsoft','7C:ED:8D':'Microsoft',
  'B4:0E:DE':'Microsoft','B8:31:B5':'Microsoft','C8:3F:26':'Microsoft','DC:B4:C4':'Microsoft',

  // ── Amazon / Ring / Echo ──
  '00:FC:8B':'Amazon','0C:47:C9':'Amazon','10:CE:A9':'Amazon',
  '18:74:2E':'Amazon','1C:12:B0':'Amazon','24:4C:E3':'Amazon','2C:54:91':'Amazon',
  '34:D2:70':'Amazon','38:F7:3D':'Amazon','40:B4:CD':'Amazon','44:65:0D':'Amazon',
  '4C:EF:C0':'Amazon','50:DC:E7':'Amazon','54:97:BD':'Amazon',
  '68:37:E9':'Amazon','68:54:FD':'Amazon','6C:56:97':'Amazon','74:C2:46':'Amazon',
  '78:E1:03':'Amazon','84:D6:D0':'Amazon','8C:49:62':'Amazon','90:F1:AA':'Amazon',
  '94:53:30':'Amazon','A0:02:DB':'Amazon','AC:63:BE':'Amazon','B4:7C:9C':'Amazon',
  'C0:49:EF':'Amazon','CC:9E:A2':'Amazon','F0:27:2D':'Amazon',
  'F0:D2:F1':'Amazon','F0:F0:A4':'Amazon','FC:65:DE':'Amazon',

  // ── Dell ──
  '00:06:5B':'Dell','00:08:74':'Dell','00:0B:DB':'Dell','00:0D:56':'Dell','00:0F:1F':'Dell',
  '00:11:43':'Dell','00:12:3F':'Dell','00:13:72':'Dell','00:14:22':'Dell','00:15:C5':'Dell',
  '00:18:8B':'Dell','00:19:B9':'Dell','00:1A:A0':'Dell','00:1C:23':'Dell','00:1D:09':'Dell',
  '00:1E:4F':'Dell','00:21:70':'Dell','00:22:19':'Dell','00:24:E8':'Dell','00:26:B9':'Dell',
  '14:18:77':'Dell','14:B3:1F':'Dell','18:03:73':'Dell','18:66:DA':'Dell','18:A9:9B':'Dell',
  '18:DB:F2':'Dell','1C:40:24':'Dell','24:B6:FD':'Dell','28:F1:0E':'Dell','34:17:EB':'Dell',
  '44:A8:42':'Dell','48:4D:7E':'Dell','4C:76:25':'Dell','50:9A:4C':'Dell','54:9F:35':'Dell',
  '5C:26:0A':'Dell','64:00:6A':'Dell','74:86:7A':'Dell','78:2B:CB':'Dell','80:18:44':'Dell',
  '84:7B:EB':'Dell','8C:EC:4B':'Dell','98:90:96':'Dell','A4:1F:72':'Dell','A4:BA:DB':'Dell',
  'B0:83:FE':'Dell','B4:E1:0F':'Dell','B8:2A:72':'Dell','B8:AC:6F':'Dell','BC:30:5B':'Dell',
  'C8:1F:66':'Dell','D0:94:66':'Dell','D4:81:D7':'Dell','D4:BE:D9':'Dell','E0:DB:55':'Dell',
  'E4:F0:04':'Dell','F0:1F:AF':'Dell','F4:8E:38':'Dell','F8:B1:56':'Dell','F8:BC:12':'Dell',

  // ── HP ──
  '00:01:E6':'HP','00:02:A5':'HP','00:04:EA':'HP','00:08:02':'HP','00:0B:CD':'HP',
  '00:0D:9D':'HP','00:0F:20':'HP','00:0F:61':'HP','00:10:83':'HP','00:11:0A':'HP',
  '00:12:79':'HP','00:13:21':'HP','00:14:38':'HP','00:15:60':'HP','00:17:08':'HP',
  '00:18:FE':'HP','00:19:BB':'HP','00:1A:4B':'HP','00:1B:78':'HP','00:1C:C4':'HP',
  '00:1E:0B':'HP','00:1F:29':'HP','00:21:5A':'HP','00:22:64':'HP','00:23:7D':'HP',
  '00:24:81':'HP','00:25:B3':'HP','00:26:55':'HP','08:00:09':'HP','10:1F:74':'HP',
  '1C:C1:DE':'HP','24:BE:05':'HP','28:92:4A':'HP','2C:23:3A':'HP','2C:44:FD':'HP',
  '2C:59:E5':'HP','30:E1:71':'HP','38:63:BB':'HP','3C:D9:2B':'HP','40:B0:34':'HP',
  '48:0F:CF':'HP','4C:39:09':'HP','58:20:B1':'HP','64:51:06':'HP','68:B5:99':'HP',
  '70:10:6F':'HP','78:AC:C0':'HP','80:CE:62':'HP','80:E8:2C':'HP','84:34:97':'HP',
  '8C:DC:D4':'HP','94:18:82':'HP','94:57:A5':'HP','98:E7:F4':'HP','9C:8E:99':'HP',
  'A0:1D:48':'HP','A0:D3:C1':'HP','A4:5D:36':'HP','B0:5A:DA':'HP',
  'B4:B5:2F':'HP','B8:AF:67':'HP','C4:34:6B':'HP','C8:B5:AD':'HP','CC:3E:5F':'HP',
  'D0:BF:9C':'HP','D4:C9:EF':'HP','D8:D3:85':'HP','DC:4A:3E':'HP','E0:07:1B':'HP',
  'E4:11:5B':'HP','E8:F7:24':'HP','EC:B1:D7':'HP','F0:92:1C':'HP','F4:03:43':'HP',

  // ── Espressif (ESP8266/ESP32 IoT boards) ──
  '08:3A:F2':'Espressif','0C:DC:7E':'Espressif','10:06:1C':'Espressif','10:52:1C':'Espressif',
  '18:FE:34':'Espressif','24:0A:C4':'Espressif','24:62:AB':'Espressif','24:6F:28':'Espressif',
  '24:A1:60':'Espressif','2C:F4:32':'Espressif','30:AE:A4':'Espressif','3C:61:05':'Espressif',
  '3C:71:BF':'Espressif','40:91:51':'Espressif','44:17:93':'Espressif',
  '4C:11:AE':'Espressif','4C:75:25':'Espressif','54:32:04':'Espressif','58:BF:25':'Espressif',
  '5C:CF:7F':'Espressif','60:01:94':'Espressif','68:C6:3A':'Espressif','70:03:9F':'Espressif',
  '78:21:84':'Espressif','7C:9E:BD':'Espressif','80:7D:3A':'Espressif',
  '84:CC:A8':'Espressif','8C:AA:B5':'Espressif','90:97:D5':'Espressif',
  '94:3C:C6':'Espressif','98:F4:AB':'Espressif','A0:20:A6':'Espressif','A0:76:4E':'Espressif',
  'AC:67:B2':'Espressif','B4:E6:2D':'Espressif',
  'BC:DD:C2':'Espressif','C4:5B:BE':'Espressif',
  'C8:C9:A3':'Espressif','CC:50:E3':'Espressif','D8:A0:1D':'Espressif','D8:BF:C0':'Espressif',
  'DC:4F:22':'Espressif','E0:98:06':'Espressif','EC:FA:BC':'Espressif',
  'F0:08:D1':'Espressif','F4:12:FA':'Espressif','F4:CF:A2':'Espressif','FC:F5:C4':'Espressif',

  // ── Raspberry Pi ──
  '28:CD:C1':'Raspberry Pi','B8:27:EB':'Raspberry Pi','D8:3A:DD':'Raspberry Pi',
  'DC:A6:32':'Raspberry Pi','E4:5F:01':'Raspberry Pi',

  // ── LG Electronics ──
  '00:1C:62':'LG','00:1E:75':'LG','00:1F:6B':'LG','00:1F:E3':'LG','00:22:A9':'LG',
  '00:24:83':'LG','00:26:E2':'LG','10:68:3F':'LG','14:C9:13':'LG','20:3D:BD':'LG',
  '28:6D:97':'LG','2C:54:CF':'LG','30:E3:71':'LG','34:FC:EF':'LG','38:8B:59':'LG',
  '40:B8:9A':'LG','44:07:4F':'LG','50:55:27':'LG','58:A2:B5':'LG','5C:70:A3':'LG',
  '64:89:9A':'LG','6C:D6:8A':'LG','74:40:BE':'LG','78:54:2E':'LG','7C:1C:F1':'LG',
  '88:07:4B':'LG','88:C9:D0':'LG','8C:3A:E3':'LG','A0:39:F7':'LG','A4:7E:39':'LG',
  'A8:23:FE':'LG','AC:0D:1B':'LG','B4:E6:2A':'LG','BC:F5:AC':'LG','C4:36:6C':'LG',
  'C4:9A:02':'LG','C8:08:E9':'LG','CC:2D:8C':'LG','D0:D0:03':'LG','D8:E0:E1':'LG',
  'E8:5B:5B':'LG','F8:0C:F3':'LG','F8:23:B2':'LG',

  // ── Sony ──
  '00:04:1F':'Sony','00:0A:D9':'Sony','00:0E:07':'Sony','00:13:A9':'Sony','00:15:C1':'Sony',
  '00:19:63':'Sony','00:1A:80':'Sony','00:1D:BA':'Sony','00:1F:A7':'Sony','00:21:4F':'Sony',
  '00:24:BE':'Sony','04:5D:4B':'Sony','10:D5:42':'Sony','28:0D:FC':'Sony','2C:A1:F2':'Sony',
  '30:17:C8':'Sony','40:B8:37':'Sony','48:44:87':'Sony','58:48:22':'Sony','78:84:3C':'Sony',
  '84:00:D2':'Sony','A8:E3:EE':'Sony','B0:05:94':'Sony','BC:60:A7':'Sony','F8:D0:AC':'Sony',

  // ── Roku ──
  '20:EF:BD':'Roku','84:EA:ED':'Roku','AC:3A:7A':'Roku','B0:A7:37':'Roku',
  'B8:3E:59':'Roku','C8:3A:6B':'Roku','D4:E2:2F':'Roku','DC:3A:5E':'Roku',

  // ── Ring (Amazon) ──
  '0C:97:17':'Ring','34:3E:A4':'Ring','50:14:79':'Ring',

  // ── Sonos ──
  '00:0E:58':'Sonos','34:7E:5C':'Sonos','48:A6:B8':'Sonos','5C:AA:FD':'Sonos',
  '78:28:CA':'Sonos','94:9F:3E':'Sonos','B8:E9:37':'Sonos',

  // ── Nest / Google Home ──
  '18:B4:30':'Nest','64:16:66':'Nest','D8:EB:46':'Nest','F4:F5:D8':'Nest',

  // ── Ubiquiti ──
  '00:15:6D':'Ubiquiti','00:27:22':'Ubiquiti','04:18:D6':'Ubiquiti','18:E8:29':'Ubiquiti',
  '24:5A:4C':'Ubiquiti','24:A4:3C':'Ubiquiti','44:D9:E7':'Ubiquiti','68:D7:9A':'Ubiquiti',
  '74:83:C2':'Ubiquiti','78:8A:20':'Ubiquiti','80:2A:A8':'Ubiquiti','B4:FB:E4':'Ubiquiti',
  'DC:9F:DB':'Ubiquiti','E0:63:DA':'Ubiquiti','F0:9F:C2':'Ubiquiti','FC:EC:DA':'Ubiquiti',

  // ── Aruba / HPE ──
  '00:0B:86':'Aruba','00:1A:1E':'Aruba','00:24:6C':'Aruba','04:BD:88':'Aruba',
  '18:64:72':'Aruba','20:4C:03':'Aruba','24:DE:C6':'Aruba','40:E3:D6':'Aruba',
  '6C:F3:7F':'Aruba','84:D4:7E':'Aruba','94:B4:0F':'Aruba','9C:1C:12':'Aruba',
  'AC:A3:1E':'Aruba','D8:C7:C8':'Aruba',

  // ── Motorola / Lenovo ──
  '00:04:2D':'Motorola','00:08:0E':'Motorola','00:0A:28':'Motorola','00:0C:E5':'Motorola',
  '00:0E:C4':'Motorola','00:11:1A':'Motorola','00:13:71':'Motorola','00:17:00':'Motorola',
  '00:19:A6':'Motorola','00:1C:FB':'Motorola','0C:F8:93':'Motorola','14:A7:2B':'Motorola',
  '28:CC:01':'Lenovo','30:D1:6B':'Lenovo','44:03:2C':'Lenovo','50:7B:9D':'Lenovo',
  '54:E1:AD':'Lenovo','5C:C9:D3':'Lenovo','6C:4B:90':'Lenovo','74:70:FD':'Lenovo',
  '7C:7A:91':'Lenovo','84:A6:C8':'Lenovo','98:FA:9B':'Lenovo','A4:34:D9':'Lenovo',
  'A8:13:74':'Lenovo','C0:18:50':'Lenovo','C8:5B:76':'Lenovo',
  'F8:75:A4':'Lenovo',

  // ── OnePlus / Oppo / Realme / BBK ──
  '00:3D:E8':'OnePlus','6C:3B:6B':'OnePlus','94:65:2D':'OnePlus','C0:EE:40':'OnePlus',
  '64:A2:F9':'OPPO','7C:03:AB':'OPPO','A0:3B:E3':'OPPO','CC:2D:21':'OPPO','E8:61:7E':'OPPO',

  // ── Synology (NAS) ──
  '00:11:32':'Synology',

  // ── QNAP (NAS) ──
  '00:08:9B':'QNAP','24:5E:BE':'QNAP',

  // ── D-Link ──
  '00:05:5D':'D-Link','00:0D:88':'D-Link','00:0F:3D':'D-Link','00:11:95':'D-Link',
  '00:13:46':'D-Link','00:15:E9':'D-Link','00:17:9A':'D-Link','00:19:5B':'D-Link',
  '00:1B:11':'D-Link','00:1C:F0':'D-Link','00:1E:58':'D-Link','00:22:B0':'D-Link',
  '00:24:01':'D-Link','00:26:5A':'D-Link','1C:7E:E5':'D-Link','28:10:7B':'D-Link',
  '34:08:04':'D-Link','3C:1E:04':'D-Link','78:32:1B':'D-Link','84:C9:B2':'D-Link',
  '9C:D6:43':'D-Link','B8:A3:86':'D-Link','C0:A0:BB':'D-Link','C4:12:F5':'D-Link',
  'C8:BE:19':'D-Link','CC:B2:55':'D-Link','F0:7D:68':'D-Link','FC:75:16':'D-Link',

  // ── Belkin / Linksys (Foxconn) ──
  '00:17:3F':'Belkin','00:1C:DF':'Belkin','08:86:3B':'Belkin','14:91:82':'Belkin',
  '30:23:03':'Belkin','58:EF:68':'Belkin','94:10:3E':'Belkin','B4:75:0E':'Belkin',
  'C0:56:27':'Belkin','EC:1A:59':'Belkin',

  // ── ZTE ──
  '00:19:CB':'ZTE','00:1D:D0':'ZTE','00:22:93':'ZTE','00:25:12':'ZTE','00:26:ED':'ZTE',
  '04:C0:6F':'ZTE','0C:12:62':'ZTE','18:68:CB':'ZTE','28:28:5D':'ZTE','34:4B:50':'ZTE',
  '40:F3:85':'ZTE','4C:09:D4':'ZTE','54:22:F8':'ZTE','5C:4C:A9':'ZTE','64:13:6C':'ZTE',
  '68:A0:F6':'ZTE','74:43:56':'ZTE','7C:B1:5D':'ZTE','84:74:60':'ZTE','90:D8:F3':'ZTE',
  '9C:D2:4B':'ZTE','B0:75:D5':'ZTE','C8:64:C7':'ZTE','CC:79:CF':'ZTE','D0:15:4A':'ZTE',
  'D4:61:2E':'ZTE','DC:02:8E':'ZTE','DC:39:6F':'ZTE','E0:19:1D':'ZTE','F4:B8:A7':'ZTE',
  'F8:4A:BF':'ZTE',

  // ── Technicolor / Thomson ──
  '00:14:7F':'Technicolor','00:17:7C':'Technicolor','00:1A:2B':'Technicolor','00:1C:A2':'Technicolor',
  '00:1E:69':'Technicolor','00:22:2D':'Technicolor','00:24:D1':'Technicolor','00:26:44':'Technicolor',
  '18:62:2C':'Technicolor','30:D3:2D':'Technicolor','44:E9:DD':'Technicolor','5C:35:3B':'Technicolor',
  '78:94:B4':'Technicolor','A0:1B:29':'Technicolor','CC:7E:E7':'Technicolor','E8:F1:B0':'Technicolor',

  // ── Nintendo ──
  '00:09:BF':'Nintendo','00:16:56':'Nintendo','00:17:AB':'Nintendo','00:19:1D':'Nintendo',
  '00:1A:E9':'Nintendo','00:1B:EA':'Nintendo','00:1C:BE':'Nintendo','00:1D:BC':'Nintendo',
  '00:1E:35':'Nintendo','00:1F:32':'Nintendo','00:21:47':'Nintendo','00:21:BD':'Nintendo',
  '00:22:4C':'Nintendo','00:22:AA':'Nintendo','00:23:31':'Nintendo','00:24:1E':'Nintendo',
  '00:24:44':'Nintendo','00:24:F3':'Nintendo','00:25:A0':'Nintendo','00:26:59':'Nintendo',
  '00:27:09':'Nintendo','2C:10:C1':'Nintendo','34:AF:2C':'Nintendo','40:F4:07':'Nintendo',
  '58:BD:A3':'Nintendo','78:A2:A0':'Nintendo','8C:CD:E8':'Nintendo','98:41:5C':'Nintendo',
  '9C:E6:35':'Nintendo','A4:5E:60':'Nintendo','B8:AE:6E':'Nintendo','CC:FB:65':'Nintendo',
  'DC:68:EB':'Nintendo','E0:E7:51':'Nintendo','E8:4E:CE':'Nintendo',

  // ── Broadcom ──
  '00:05:B5':'Broadcom','00:10:18':'Broadcom','00:90:4C':'Broadcom','24:0A:64':'Broadcom',

  // ── Realtek ──
  '00:E0:4C':'Realtek','4C:ED:FB':'Realtek','52:54:00':'Realtek','80:00:0B':'Realtek',

  // ── MediaTek ──
  '00:0C:E7':'MediaTek','CC:2D:E0':'MediaTek',

  // ── Qualcomm ──
  '00:03:7F':'Qualcomm','00:A0:C6':'Qualcomm','9C:F5:8E':'Qualcomm',

  // ── VMware ──
  '00:0C:29':'VMware','00:15:5D':'VMware','00:50:56':'VMware','00:1C:14':'VMware',

  // ── Philips (Hue) ──
  '00:17:88':'Philips Hue','EC:B5:FA':'Philips Hue',

  // ── Bose ──
  '04:52:C7':'Bose','08:DF:1F':'Bose','2C:41:A1':'Bose','4C:87:5D':'Bose',

  // ── Dyson ──
  'C8:FF:77':'Dyson',

  // ── Wyze ──
  '2C:AA:8E':'Wyze','7C:78:B2':'Wyze',

  // ── TP-Link (Kasa / Tapo) ──
  '1C:61:B4':'TP-Link Kasa','50:C7:BF':'TP-Link Kasa','B0:4E:26':'TP-Link Kasa',
  '60:A4:B7':'TP-Link Kasa','D8:0D:17':'TP-Link Kasa',

  // ── Tuya smart devices ──
  'D8:1F:12':'Tuya','10:D5:61':'Tuya',

  // ── Shelly ──
  '34:94:54':'Shelly','48:3F:DA':'Shelly','84:0D:8E':'Shelly','C4:4F:33':'Shelly',
  'C8:2B:96':'Shelly','80:64:6F':'Shelly','30:C6:F7':'Shelly','E8:9F:6D':'Shelly',
}

/**
 * Look up vendor from a MAC address string.
 * @param {string} mac - e.g. "c4:e9:84:1c:22:fa" or "C4-E9-84-1C-22-FA"
 * @returns {string|null} Vendor name or null
 */
function lookupVendor(mac) {
  if (!mac || typeof mac !== 'string') return null
  const norm = mac.replace(/-/g, ':').toUpperCase()
  const prefix = norm.substring(0, 8) // "C4:E9:84"
  return OUI[prefix] || null
}

module.exports = { lookupVendor }
