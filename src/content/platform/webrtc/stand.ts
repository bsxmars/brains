/**
 * Журнал стенда темы «WebRTC» — без правок, кроме адреса машины в локальной сети: заменён на 192.168.1.105 (строка той же длины).
 * Как снят — в шапке data.ts. Пересобирать скриптами стенда (collect.mjs + extract.mjs), не руками.
 */

export const STAND = {
 "version": "153.0.8010.12",
 "scenarios": {
  "host": {
   "config": {},
   "caller": {
    "log": [
     {
      "ms": 27,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 29,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 31,
      "k": "icecandidate",
      "v": "candidate:3416709932 1 udp 2113937151 fefbb9f2-f057-4136-8b4b-55226f6d7990.local 52020 typ host generation 0 ufrag TCgj network-cost 999"
     },
     {
      "ms": 33,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 35,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 35,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 37,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 37,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 37,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 39,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 41,
      "k": "message",
      "v": "и тебе привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "IDmERT6Iy",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 51377,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "1368471806"
     },
     {
      "id": "IVpSMeh/K",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 52020,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "3416709932"
     },
     {
      "id": "IrR3OLXrE",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 54786,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "51789610"
     }
    ],
    "pairs": [
     {
      "id": "CPVpSMeh/K_rR3OLXrE",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 9079290933572287000,
      "localCandidateId": "IVpSMeh/K",
      "remoteCandidateId": "IrR3OLXrE",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPVpSMeh/K_rR3OLXrE"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 207,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 208,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 208,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 210,
      "k": "icecandidate",
      "v": "candidate:51789610 1 udp 2113937151 5b7caf6a-3559-4ba0-b284-0950b9b67cf4.local 54786 typ host generation 0 ufrag Azty network-cost 999"
     },
     {
      "ms": 210,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 210,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 212,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 212,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 212,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 214,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 217,
      "k": "datachannel",
      "v": "chat"
     },
     {
      "ms": 217,
      "k": "message",
      "v": "привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "IfU5md4mN",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 56955,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "1430124055"
     },
     {
      "id": "In1qXej6R",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 52020,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "3416709932"
     },
     {
      "id": "IqQFN9Ar1",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 54786,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "51789610"
     }
    ],
    "pairs": [
     {
      "id": "CPqQFN9Ar1_n1qXej6R",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 9079290933572287000,
      "localCandidateId": "IqQFN9Ar1",
      "remoteCandidateId": "In1qXej6R",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPqQFN9Ar1_n1qXej6R"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 1270620933866676358 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:TCgj\r\na=ice-pwd:roQ6l5tLddN6sY/e4Wdea9fz\r\na=ice-options:trickle\r\na=fingerprint:sha-256 B9:8E:B9:15:3E:41:1C:1D:B1:5C:3E:C7:09:F1:DE:FF:A4:C9:A5:28:3C:2B:97:C0:81:94:96:1D:13:92:2A:35\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 223,
     "candidate": "candidate:3416709932 1 udp 2113937151 fefbb9f2-f057-4136-8b4b-55226f6d7990.local 52020 typ host generation 0 ufrag TCgj network-cost 999"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 532,
     "sdp": "v=0\r\no=- 400523125522734008 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:Azty\r\na=ice-pwd:/uRBZyWbCjGdMagVptXiUe0m\r\na=ice-options:trickle\r\na=fingerprint:sha-256 A7:6E:5A:15:5A:79:B5:8F:D9:18:8B:AA:59:CD:E0:67:CF:DE:C6:31:06:A6:98:A1:DE:B4:A6:7C:DD:C3:09:28\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 221,
     "candidate": "candidate:51789610 1 udp 2113937151 5b7caf6a-3559-4ba0-b284-0950b9b67cf4.local 54786 typ host generation 0 ufrag Azty network-cost 999"
    }
   ],
   "turn": [],
   "relayStats": []
  },
  "stun": {
   "config": {
    "iceServers": [
     {
      "urls": "stun:192.168.1.105:50910"
     }
    ]
   },
   "caller": {
    "log": [
     {
      "ms": 21,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 21,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 22,
      "k": "icecandidate",
      "v": "candidate:3653941407 1 udp 2113937151 25fa57d7-787d-4180-a013-858c00830d96.local 49180 typ host generation 0 ufrag dgL+ network-cost 999"
     },
     {
      "ms": 24,
      "k": "icecandidate",
      "v": "candidate:1923148274 1 udp 1677729535 192.168.1.105 50180 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag dgL+ network-cost 999"
     },
     {
      "ms": 26,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 27,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 27,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 27,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 27,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 27,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 28,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 31,
      "k": "message",
      "v": "и тебе привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I4U4gW8g9",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 52071,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "1140677453"
     },
     {
      "id": "IMgpf135v",
      "type": "local-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 50180,
      "protocol": "udp",
      "priority": 1677729535,
      "url": "stun:192.168.1.105:50910",
      "foundation": "1923148274"
     },
     {
      "id": "Ik4SyT+nZ",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 49180,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "3653941407"
     },
     {
      "id": "IsLPpXW3q",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 51696,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "4133211840"
     }
    ],
    "pairs": [
     {
      "id": "CPk4SyT+nZ_sLPpXW3q",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 9079290933572287000,
      "localCandidateId": "Ik4SyT+nZ",
      "remoteCandidateId": "IsLPpXW3q",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPk4SyT+nZ_sLPpXW3q"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 160,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 160,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 160,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 161,
      "k": "icecandidate",
      "v": "candidate:4133211840 1 udp 2113937151 2aea4496-df77-4405-90e8-ea316646e049.local 51696 typ host generation 0 ufrag +5oq network-cost 999"
     },
     {
      "ms": 162,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 162,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 163,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 163,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 163,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 164,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 167,
      "k": "datachannel",
      "v": "chat"
     },
     {
      "ms": 167,
      "k": "message",
      "v": "привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I7me5Ogbx",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 55388,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "1819028754"
     },
     {
      "id": "IiHRqSyt2",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 51696,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "4133211840"
     },
     {
      "id": "Is5kCvwAE",
      "type": "remote-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 50180,
      "protocol": "udp",
      "priority": 1677729535,
      "foundation": "1923148274"
     },
     {
      "id": "IvW4c5kFE",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 49180,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "3653941407"
     }
    ],
    "pairs": [
     {
      "id": "CPiHRqSyt2_s5kCvwAE",
      "type": "candidate-pair",
      "state": "in-progress",
      "nominated": false,
      "priority": 7205793488586161000,
      "localCandidateId": "IiHRqSyt2",
      "remoteCandidateId": "Is5kCvwAE",
      "requestsSent": 4,
      "responsesReceived": 0
     },
     {
      "id": "CPiHRqSyt2_vW4c5kFE",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 9079290933572287000,
      "localCandidateId": "IiHRqSyt2",
      "remoteCandidateId": "IvW4c5kFE",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPiHRqSyt2_vW4c5kFE"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 4628209007490974174 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:dgL+\r\na=ice-pwd:khAmS8sx39fw1zjDemox+YwF\r\na=ice-options:trickle\r\na=fingerprint:sha-256 85:5F:60:02:80:E5:3B:EC:0C:11:5C:EC:DC:2C:51:66:B4:49:DE:75:24:AD:A3:D3:BA:D8:0D:07:38:9A:F7:CA\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 223,
     "candidate": "candidate:3653941407 1 udp 2113937151 25fa57d7-787d-4180-a013-858c00830d96.local 49180 typ host generation 0 ufrag dgL+ network-cost 999"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 217,
     "candidate": "candidate:1923148274 1 udp 1677729535 192.168.1.105 50180 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag dgL+ network-cost 999"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 1312267187308888258 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:+5oq\r\na=ice-pwd:fVRiNAbB76uGoE9Isx2k8mbF\r\na=ice-options:trickle\r\na=fingerprint:sha-256 46:A5:0A:82:41:CF:2B:AC:0A:1F:B4:43:84:F6:16:78:56:91:BA:04:0E:97:66:B5:5A:6C:2E:09:DD:FE:7E:8B\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 223,
     "candidate": "candidate:4133211840 1 udp 2113937151 2aea4496-df77-4405-90e8-ea316646e049.local 51696 typ host generation 0 ufrag +5oq network-cost 999"
    }
   ],
   "turn": [
    {
     "from": "192.168.1.105:49180",
     "method": "Binding",
     "mapped": "192.168.1.105:50180"
    },
    {
     "from": "192.168.1.105:51696",
     "method": "Binding",
     "mapped": "192.168.1.105:52696"
    }
   ],
   "relayStats": []
  },
  "relay": {
   "config": {
    "iceServers": [
     {
      "urls": "turn:192.168.1.105:50910?transport=udp",
      "username": "alice",
      "credential": "secret"
     }
    ],
    "iceTransportPolicy": "relay"
   },
   "caller": {
    "log": [
     {
      "ms": 22,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 22,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 26,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 87,
      "k": "icecandidate",
      "v": "candidate:3978506643 1 udp 50339839 192.168.1.105 50920 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag LwHV network-cost 999"
     },
     {
      "ms": 87,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 87,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 89,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 89,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 89,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 91,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 94,
      "k": "message",
      "v": "и тебе привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I4t3F2ULD",
      "type": "remote-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50921,
      "protocol": "udp",
      "priority": 50339839,
      "foundation": "2239969783"
     },
     {
      "id": "Iay6BxgZz",
      "type": "local-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50920,
      "protocol": "udp",
      "priority": 50339839,
      "relayProtocol": "udp",
      "url": "turn:192.168.1.105:50910?transport=udp",
      "foundation": "3978506643"
     }
    ],
    "pairs": [
     {
      "id": "CPay6BxgZz_4t3F2ULD",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 216207962291585020,
      "localCandidateId": "Iay6BxgZz",
      "remoteCandidateId": "I4t3F2ULD",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPay6BxgZz_4t3F2ULD"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 155,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 155,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 155,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 217,
      "k": "icecandidate",
      "v": "candidate:2239969783 1 udp 50339839 192.168.1.105 50921 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag wiBT network-cost 999"
     },
     {
      "ms": 218,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 218,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 220,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 220,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 220,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 222,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 224,
      "k": "datachannel",
      "v": "chat"
     },
     {
      "ms": 224,
      "k": "message",
      "v": "привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "IMTPS90T1",
      "type": "remote-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50920,
      "protocol": "udp",
      "priority": 50339839,
      "foundation": "3978506643"
     },
     {
      "id": "Ihvsu2P8P",
      "type": "local-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50921,
      "protocol": "udp",
      "priority": 50339839,
      "relayProtocol": "udp",
      "url": "turn:192.168.1.105:50910?transport=udp",
      "foundation": "2239969783"
     }
    ],
    "pairs": [
     {
      "id": "CPhvsu2P8P_MTPS90T1",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 216207962291585020,
      "localCandidateId": "Ihvsu2P8P",
      "remoteCandidateId": "IMTPS90T1",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPhvsu2P8P_MTPS90T1"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 3914301228574207503 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:LwHV\r\na=ice-pwd:7/LQSCijYqawpxKTFqfl3RQr\r\na=ice-options:trickle\r\na=fingerprint:sha-256 6A:3D:10:14:A0:E9:4B:04:0F:80:3B:C1:4A:5A:44:F1:67:46:0F:4B:29:8E:85:DF:86:AF:3D:62:01:1C:E7:F6\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 5742394286013033244 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:wiBT\r\na=ice-pwd:1pQlorE/qDLcI7X6Qk+U7HRt\r\na=ice-options:trickle\r\na=fingerprint:sha-256 C2:65:EE:62:F6:EC:3E:C9:C7:E9:FE:7A:8A:E1:41:C7:4A:8D:0E:B6:A6:BA:8C:A9:7D:16:90:F9:FA:98:74:98\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 215,
     "candidate": "candidate:3978506643 1 udp 50339839 192.168.1.105 50920 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag LwHV network-cost 999"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 215,
     "candidate": "candidate:2239969783 1 udp 50339839 192.168.1.105 50921 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag wiBT network-cost 999"
    }
   ],
   "turn": [
    {
     "from": "192.168.1.105:54024",
     "method": "Binding",
     "mapped": "192.168.1.105:55024"
    },
    {
     "from": "192.168.1.105:56118",
     "method": "Binding",
     "mapped": "192.168.1.105:57118"
    },
    {
     "from": "192.168.1.105:54024",
     "method": "Allocate",
     "result": "401"
    },
    {
     "from": "192.168.1.105:56118",
     "method": "Allocate",
     "result": "401"
    },
    {
     "from": "192.168.1.105:54024",
     "method": "Allocate",
     "result": "ok",
     "relayed": "192.168.1.105:50920"
    },
    {
     "from": "192.168.1.105:56118",
     "method": "Allocate",
     "result": "ok",
     "relayed": "192.168.1.105:50921"
    },
    {
     "from": "192.168.1.105:56118",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:54024",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:56118",
     "method": "ChannelBind",
     "channel": "0x4000",
     "peer": "192.168.1.105:50920"
    },
    {
     "from": "192.168.1.105:54024",
     "method": "ChannelBind",
     "channel": "0x4000",
     "peer": "192.168.1.105:50921"
    }
   ],
   "relayStats": [
    {
     "relayPort": 50920,
     "sendInd": 4,
     "dataInd": 4,
     "channelDataOut": 15,
     "channelDataIn": 14
    },
    {
     "relayPort": 50921,
     "sendInd": 4,
     "dataInd": 2,
     "channelDataOut": 14,
     "channelDataIn": 17
    }
   ]
  },
  "symturn": {
   "config": {
    "iceServers": [
     {
      "urls": "turn:192.168.1.105:50910?transport=udp",
      "username": "alice",
      "credential": "secret"
     }
    ]
   },
   "caller": {
    "log": [
     {
      "ms": 23,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 23,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 24,
      "k": "icecandidate",
      "v": "candidate:922590967 1 udp 2113937151 d907ce51-7e57-4415-b1f0-996cfe49dfd6.local 53421 typ host generation 0 ufrag ajVJ network-cost 999"
     },
     {
      "ms": 26,
      "k": "icecandidate",
      "v": "candidate:2643971994 1 udp 1677729535 192.168.1.105 54421 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag ajVJ network-cost 999"
     },
     {
      "ms": 29,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 30,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 30,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 82,
      "k": "icecandidate",
      "v": "candidate:862604198 1 udp 50339839 192.168.1.105 50920 typ relay raddr 192.168.1.105 rport 54421 generation 0 ufrag ajVJ network-cost 999"
     },
     {
      "ms": 144,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 144,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 157,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 160,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 164,
      "k": "message",
      "v": "и тебе привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I46ym65+G",
      "type": "remote-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 63401,
      "protocol": "udp",
      "priority": 1677729535,
      "foundation": "3438666876"
     },
     {
      "id": "IKDmKVRhM",
      "type": "local-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50920,
      "protocol": "udp",
      "priority": 50339839,
      "relayProtocol": "udp",
      "url": "turn:192.168.1.105:50910?transport=udp",
      "foundation": "862604198"
     },
     {
      "id": "INoTt3J49",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 54206,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "2898951461"
     },
     {
      "id": "IS1ue6ztr",
      "type": "local-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 54421,
      "protocol": "udp",
      "priority": 1677729535,
      "url": "stun:192.168.1.105:50910",
      "foundation": "2643971994"
     },
     {
      "id": "ISC6gX+3F",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 53421,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "922590967"
     },
     {
      "id": "ISUXfnQM7",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509959935,
      "foundation": "1382066609"
     },
     {
      "id": "IU4KTW9S2",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509957375,
      "foundation": "1464814922"
     },
     {
      "id": "IaAKMn0OO",
      "type": "remote-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50921,
      "protocol": "udp",
      "priority": 50339839,
      "foundation": "1644716096"
     },
     {
      "id": "IaGJS2Y+F",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 62401,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "1738519825"
     },
     {
      "id": "IzcVMLiF0",
      "type": "remote-candidate",
      "candidateType": "prflx",
      "address": "",
      "port": 62394,
      "protocol": "udp",
      "priority": 1845501695,
      "foundation": "2389097566"
     }
    ],
    "pairs": [
     {
      "id": "CPKDmKVRhM_46ym65+G",
      "type": "candidate-pair",
      "state": "waiting",
      "nominated": false,
      "priority": 216207965546364400,
      "localCandidateId": "IKDmKVRhM",
      "remoteCandidateId": "I46ym65+G",
      "requestsSent": 0,
      "responsesReceived": 0
     },
     {
      "id": "CPKDmKVRhM_aAKMn0OO",
      "type": "candidate-pair",
      "state": "waiting",
      "nominated": false,
      "priority": 216207962291585020,
      "localCandidateId": "IKDmKVRhM",
      "remoteCandidateId": "IaAKMn0OO",
      "requestsSent": 0,
      "responsesReceived": 0
     },
     {
      "id": "CPKDmKVRhM_zcVMLiF0",
      "type": "candidate-pair",
      "state": "waiting",
      "nominated": false,
      "priority": 216207965881908740,
      "localCandidateId": "IKDmKVRhM",
      "remoteCandidateId": "IzcVMLiF0",
      "requestsSent": 0,
      "responsesReceived": 0
     },
     {
      "id": "CPSC6gX+3F_46ym65+G",
      "type": "candidate-pair",
      "state": "in-progress",
      "nominated": false,
      "priority": 7205793488586161000,
      "localCandidateId": "ISC6gX+3F",
      "remoteCandidateId": "I46ym65+G",
      "requestsSent": 4,
      "responsesReceived": 0
     },
     {
      "id": "CPSC6gX+3F_aAKMn0OO",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 216207966418779650,
      "localCandidateId": "ISC6gX+3F",
      "remoteCandidateId": "IaAKMn0OO",
      "requestsSent": 4,
      "responsesReceived": 4
     },
     {
      "id": "CPSC6gX+3F_aGJS2Y+F",
      "type": "candidate-pair",
      "state": "in-progress",
      "nominated": false,
      "priority": 9079290933572287000,
      "localCandidateId": "ISC6gX+3F",
      "remoteCandidateId": "IaGJS2Y+F",
      "requestsSent": 3,
      "responsesReceived": 0
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPSC6gX+3F_aAKMn0OO"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 156,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 156,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 156,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 157,
      "k": "icecandidate",
      "v": "candidate:1738519825 1 udp 2113937151 66b4acfb-a33d-4f8c-9f69-a6a180ead82b.local 62394 typ host generation 0 ufrag CqnY network-cost 999"
     },
     {
      "ms": 157,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 157,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 159,
      "k": "icecandidate",
      "v": "candidate:3438666876 1 udp 1677729535 192.168.1.105 63394 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag CqnY network-cost 999"
     },
     {
      "ms": 224,
      "k": "icecandidate",
      "v": "candidate:1644716096 1 udp 50339839 192.168.1.105 50921 typ relay raddr 192.168.1.105 rport 63394 generation 0 ufrag CqnY network-cost 999"
     },
     {
      "ms": 287,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 287,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 288,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 289,
      "k": "connectionState",
      "v": "connected"
     },
     {
      "ms": 293,
      "k": "datachannel",
      "v": "chat"
     },
     {
      "ms": 294,
      "k": "message",
      "v": "привет"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "connected",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I0JzXMi3E",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 53428,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "922590967"
     },
     {
      "id": "IJwp2ekS4",
      "type": "remote-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50920,
      "protocol": "udp",
      "priority": 50339839,
      "foundation": "862604198"
     },
     {
      "id": "ILqgOIw34",
      "type": "local-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 63394,
      "protocol": "udp",
      "priority": 1677729535,
      "url": "stun:192.168.1.105:50910",
      "foundation": "3438666876"
     },
     {
      "id": "ILyFoXE8C",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509959935,
      "foundation": "50496087"
     },
     {
      "id": "IQ4a9TFtC",
      "type": "local-candidate",
      "candidateType": "relay",
      "address": "192.168.1.105",
      "port": 50921,
      "protocol": "udp",
      "priority": 50339839,
      "relayProtocol": "udp",
      "url": "turn:192.168.1.105:50910?transport=udp",
      "foundation": "1644716096"
     },
     {
      "id": "Ibb7NURm8",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 62394,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "1738519825"
     },
     {
      "id": "IgBrO7ux1",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509957375,
      "foundation": "103638700"
     },
     {
      "id": "IgulsFC/m",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 60301,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "4255667907"
     },
     {
      "id": "IrZe9Cen3",
      "type": "remote-candidate",
      "candidateType": "prflx",
      "address": "",
      "port": 53421,
      "protocol": "udp",
      "priority": 1845501695,
      "foundation": "2078892612"
     },
     {
      "id": "ItfCu0riR",
      "type": "remote-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 54428,
      "protocol": "udp",
      "priority": 1677729535,
      "foundation": "2643971994"
     }
    ],
    "pairs": [
     {
      "id": "CPQ4a9TFtC_Jwp2ekS4",
      "type": "candidate-pair",
      "state": "waiting",
      "nominated": false,
      "priority": 216207962291585020,
      "localCandidateId": "IQ4a9TFtC",
      "remoteCandidateId": "IJwp2ekS4",
      "requestsSent": 0,
      "responsesReceived": 0
     },
     {
      "id": "CPQ4a9TFtC_rZe9Cen3",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 216207965881908740,
      "localCandidateId": "IQ4a9TFtC",
      "remoteCandidateId": "IrZe9Cen3",
      "requestsSent": 4,
      "responsesReceived": 4
     },
     {
      "id": "CPQ4a9TFtC_tfCu0riR",
      "type": "candidate-pair",
      "state": "waiting",
      "nominated": false,
      "priority": 216207965546364400,
      "localCandidateId": "IQ4a9TFtC",
      "remoteCandidateId": "ItfCu0riR",
      "requestsSent": 0,
      "responsesReceived": 0
     },
     {
      "id": "CPbb7NURm8_0JzXMi3E",
      "type": "candidate-pair",
      "state": "in-progress",
      "nominated": false,
      "priority": 9079290933572287000,
      "localCandidateId": "Ibb7NURm8",
      "remoteCandidateId": "I0JzXMi3E",
      "requestsSent": 3,
      "responsesReceived": 0
     },
     {
      "id": "CPbb7NURm8_Jwp2ekS4",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": false,
      "priority": 216207966418779650,
      "localCandidateId": "Ibb7NURm8",
      "remoteCandidateId": "IJwp2ekS4",
      "requestsSent": 3,
      "responsesReceived": 3
     },
     {
      "id": "CPbb7NURm8_tfCu0riR",
      "type": "candidate-pair",
      "state": "in-progress",
      "nominated": false,
      "priority": 7205793488586161000,
      "localCandidateId": "Ibb7NURm8",
      "remoteCandidateId": "ItfCu0riR",
      "requestsSent": 3,
      "responsesReceived": 0
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "connected",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "connected",
     "tlsVersion": "FEFC",
     "dtlsCipher": "TLS_AES_128_GCM_SHA256",
     "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
     "selectedCandidatePairId": "CPQ4a9TFtC_rZe9Cen3"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 5887821964974557052 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:ajVJ\r\na=ice-pwd:/plZHhD7b77uPFGYnbyjwRWZ\r\na=ice-options:trickle\r\na=fingerprint:sha-256 F0:42:A8:5A:66:18:7C:2F:55:CF:7C:C1:5B:3D:FB:EC:82:C9:DA:CF:6B:18:CE:29:EF:52:BA:DD:5E:EA:4B:8D\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 222,
     "candidate": "candidate:922590967 1 udp 2113937151 d907ce51-7e57-4415-b1f0-996cfe49dfd6.local 53428 typ host generation 0 ufrag ajVJ network-cost 999"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 1260902946908471953 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:CqnY\r\na=ice-pwd:oKp07KtR8d8Tjp0V9eNaInCl\r\na=ice-options:trickle\r\na=fingerprint:sha-256 EF:15:82:25:3D:09:46:F0:9F:47:3C:19:0A:BD:78:45:0D:C1:4D:E5:13:73:4D:47:11:CF:EE:6D:86:BE:59:0F\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 217,
     "candidate": "candidate:2643971994 1 udp 1677729535 192.168.1.105 54428 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag ajVJ network-cost 999"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 223,
     "candidate": "candidate:1738519825 1 udp 2113937151 66b4acfb-a33d-4f8c-9f69-a6a180ead82b.local 62401 typ host generation 0 ufrag CqnY network-cost 999"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 217,
     "candidate": "candidate:3438666876 1 udp 1677729535 192.168.1.105 63401 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag CqnY network-cost 999"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 224,
     "candidate": "candidate:862604198 1 udp 50339839 192.168.1.105 50920 typ relay raddr 192.168.1.105 rport 54421 generation 0 ufrag ajVJ network-cost 999"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 225,
     "candidate": "candidate:1644716096 1 udp 50339839 192.168.1.105 50921 typ relay raddr 192.168.1.105 rport 63394 generation 0 ufrag CqnY network-cost 999"
    }
   ],
   "turn": [
    {
     "from": "192.168.1.105:53421",
     "method": "Binding",
     "mapped": "192.168.1.105:54421"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "Binding",
     "mapped": "192.168.1.105:63394"
    },
    {
     "from": "192.168.1.105:53421",
     "method": "Allocate",
     "result": "401"
    },
    {
     "from": "192.168.1.105:53421",
     "method": "Allocate",
     "result": "ok",
     "relayed": "192.168.1.105:50920"
    },
    {
     "from": "192.168.1.105:53421",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "Allocate",
     "result": "401"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "Allocate",
     "result": "ok",
     "relayed": "192.168.1.105:50921"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:53421",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    },
    {
     "from": "192.168.1.105:62394",
     "method": "ChannelBind",
     "channel": "0x4002",
     "peer": "192.168.1.105:53421"
    },
    {
     "from": "192.168.1.105:53421",
     "method": "CreatePermission",
     "peer": "192.168.1.105"
    }
   ],
   "relayStats": [
    {
     "relayPort": 50920,
     "sendInd": 3,
     "dataInd": 3,
     "channelDataOut": 0,
     "channelDataIn": 0
    },
    {
     "relayPort": 50921,
     "sendInd": 4,
     "dataInd": 2,
     "channelDataOut": 14,
     "channelDataIn": 17
    }
   ]
  },
  "symmetric": {
   "config": {
    "iceServers": [
     {
      "urls": "stun:192.168.1.105:50910"
     }
    ]
   },
   "caller": {
    "log": [
     {
      "ms": 23,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 23,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 24,
      "k": "icecandidate",
      "v": "candidate:973245910 1 udp 2113937151 49e06cd2-6e6d-4765-898f-ab84217eb137.local 62696 typ host generation 0 ufrag Q8ef network-cost 999"
     },
     {
      "ms": 26,
      "k": "icecandidate",
      "v": "candidate:2439568571 1 udp 1677729535 192.168.1.105 63696 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag Q8ef network-cost 999"
     },
     {
      "ms": 29,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 29,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 29,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 156,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 156,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 15094,
      "k": "iceConnectionState",
      "v": "disconnected"
     },
     {
      "ms": 15094,
      "k": "connectionState",
      "v": "failed"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "disconnected",
     "conn": "failed",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I/DfP2lJK",
      "type": "local-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 63696,
      "protocol": "udp",
      "priority": 1677729535,
      "url": "stun:192.168.1.105:50910",
      "foundation": "2439568571"
     },
     {
      "id": "IBC49zXk+",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509957375,
      "foundation": "1538285163"
     },
     {
      "id": "IPQAKfEkp",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 62696,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "973245910"
     },
     {
      "id": "IiscqV7p8",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509959935,
      "foundation": "1587526288"
     },
     {
      "id": "IkbqVH6u9",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 62915,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "2687856132"
     }
    ],
    "pairs": [],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "new",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "failed"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 158,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 158,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 158,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 160,
      "k": "icecandidate",
      "v": "candidate:956683322 1 udp 2113937151 c25aec41-157d-4191-8f2d-1437d6222108.local 59738 typ host generation 0 ufrag WBbR network-cost 999"
     },
     {
      "ms": 160,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 160,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 161,
      "k": "icecandidate",
      "v": "candidate:2187976725 1 udp 1677729535 192.168.1.105 60738 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag WBbR network-cost 999"
     },
     {
      "ms": 289,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 289,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 15227,
      "k": "iceConnectionState",
      "v": "disconnected"
     },
     {
      "ms": 15227,
      "k": "connectionState",
      "v": "failed"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "disconnected",
     "conn": "failed",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I/nFRCZk9",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509959935,
      "foundation": "3482997283"
     },
     {
      "id": "I93eY+3BP",
      "type": "local-candidate",
      "candidateType": "srflx",
      "address": "192.168.1.105",
      "port": 60738,
      "protocol": "udp",
      "priority": 1677729535,
      "url": "stun:192.168.1.105:50910",
      "foundation": "2187976725"
     },
     {
      "id": "IFDv4EAFn",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 9,
      "protocol": "tcp",
      "priority": 1509957375,
      "foundation": "3760831204"
     },
     {
      "id": "IQ+MDSomL",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 50546,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "2975183035"
     },
     {
      "id": "Iq3z20zce",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 59738,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "956683322"
     }
    ],
    "pairs": [],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "new",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "failed"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 4970165486987128973 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:Q8ef\r\na=ice-pwd:V4kCVEv9/h5eqMl4xxcq7kI2\r\na=ice-options:trickle\r\na=fingerprint:sha-256 6D:0D:E2:DC:4B:17:24:86:32:38:37:7B:42:61:AB:DE:E5:08:83:09:C0:8D:5C:36:0A:4D:48:27:7D:DB:53:0F\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 222,
     "candidate": "candidate:973245910 1 udp 2113937151 49e06cd2-6e6d-4765-898f-ab84217eb137.local 62703 typ host generation 0 ufrag Q8ef network-cost 999"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 6937181949460712454 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:WBbR\r\na=ice-pwd:wUugu+PdFqB4sqnDF6ACv+5M\r\na=ice-options:trickle\r\na=fingerprint:sha-256 C9:D3:4E:E5:A8:8B:27:F0:1D:D3:DE:CB:55:73:D2:CE:84:FD:D7:5C:29:ED:50:08:5F:77:ED:E6:06:D7:CC:F1\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 217,
     "candidate": "candidate:2439568571 1 udp 1677729535 192.168.1.105 63703 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag Q8ef network-cost 999"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 222,
     "candidate": "candidate:956683322 1 udp 2113937151 c25aec41-157d-4191-8f2d-1437d6222108.local 59745 typ host generation 0 ufrag WBbR network-cost 999"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 217,
     "candidate": "candidate:2187976725 1 udp 1677729535 192.168.1.105 60745 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag WBbR network-cost 999"
    }
   ],
   "turn": [
    {
     "from": "192.168.1.105:62696",
     "method": "Binding",
     "mapped": "192.168.1.105:63696"
    },
    {
     "from": "192.168.1.105:59738",
     "method": "Binding",
     "mapped": "192.168.1.105:60738"
    },
    {
     "from": "192.168.1.105:59738",
     "method": "Binding",
     "mapped": "192.168.1.105:60738"
    },
    {
     "from": "192.168.1.105:62696",
     "method": "Binding",
     "mapped": "192.168.1.105:63696"
    }
   ],
   "relayStats": []
  },
  "norelay": {
   "config": {
    "iceTransportPolicy": "relay"
   },
   "caller": {
    "log": [
     {
      "ms": 25,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 26,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 29,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 153,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 153,
      "k": "icecandidate",
      "v": null
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "new",
     "conn": "new",
     "gather": "complete"
    },
    "candidates": [],
    "pairs": [],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "new",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "new"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 192,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 192,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 192,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 318,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 318,
      "k": "icecandidate",
      "v": null
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "new",
     "conn": "new",
     "gather": "complete"
    },
    "candidates": [],
    "pairs": [],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "new",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "new"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 1903122282216780091 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:j3rD\r\na=ice-pwd:ACuYKuIu0OZmZYe9yz0bojA0\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AE:56:6B:4A:50:A0:DA:44:18:3C:95:0B:8E:E7:A3:23:72:F1:AB:65:27:32:19:1B:A5:5D:6D:C9:F8:F8:7E:CD\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 8747434402178113089 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:tOvu\r\na=ice-pwd:uZdJ25QDwor2EjFX252ZuiQh\r\na=ice-options:trickle\r\na=fingerprint:sha-256 8A:ED:9C:92:3D:6A:D8:A9:30:17:05:3C:C0:1C:E6:84:D7:9F:0D:67:4A:B0:23:DB:F7:D1:14:63:13:58:81:97\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    }
   ],
   "turn": [],
   "relayStats": []
  },
  "badfp": {
   "config": {},
   "caller": {
    "log": [
     {
      "ms": 26,
      "k": "signalingState",
      "v": "have-local-offer"
     },
     {
      "ms": 26,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 28,
      "k": "icecandidate",
      "v": "candidate:698509131 1 udp 2113937151 eae8be60-2a39-4b37-b414-504d85ac5239.local 49594 typ host generation 0 ufrag uV9m network-cost 999"
     },
     {
      "ms": 32,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 32,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 32,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 33,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 33,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 33,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 35,
      "k": "connectionState",
      "v": "failed"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "failed",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "IDoU4IHiU",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 49594,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "698509131"
     },
     {
      "id": "IhPhNvxYZ",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 61133,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "3699918210"
     },
     {
      "id": "IjqtFV3DM",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 58526,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "2716992458"
     }
    ],
    "pairs": [
     {
      "id": "CPDoU4IHiU_hPhNvxYZ",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 9079290933572287000,
      "localCandidateId": "IDoU4IHiU",
      "remoteCandidateId": "IhPhNvxYZ",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "failed",
     "dtlsRole": "server",
     "iceRole": "controlling",
     "iceState": "connected",
     "selectedCandidatePairId": "CPDoU4IHiU_hPhNvxYZ"
    }
   },
   "callee": {
    "log": [
     {
      "ms": 180,
      "k": "signalingState",
      "v": "have-remote-offer"
     },
     {
      "ms": 181,
      "k": "signalingState",
      "v": "stable"
     },
     {
      "ms": 181,
      "k": "iceGatheringState",
      "v": "gathering"
     },
     {
      "ms": 182,
      "k": "icecandidate",
      "v": "candidate:3699918210 1 udp 2113937151 b5260fcd-76dc-4614-b03e-f9a087e613eb.local 61133 typ host generation 0 ufrag dPQP network-cost 999"
     },
     {
      "ms": 182,
      "k": "iceConnectionState",
      "v": "checking"
     },
     {
      "ms": 182,
      "k": "connectionState",
      "v": "connecting"
     },
     {
      "ms": 184,
      "k": "iceConnectionState",
      "v": "connected"
     },
     {
      "ms": 184,
      "k": "iceGatheringState",
      "v": "complete"
     },
     {
      "ms": 184,
      "k": "icecandidate",
      "v": null
     },
     {
      "ms": 186,
      "k": "connectionState",
      "v": "failed"
     }
    ],
    "states": {
     "sig": "stable",
     "ice": "connected",
     "conn": "failed",
     "gather": "complete"
    },
    "candidates": [
     {
      "id": "I0IiteNlu",
      "type": "remote-candidate",
      "candidateType": "host",
      "address": "",
      "port": 49594,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "698509131"
     },
     {
      "id": "IIQZcAmvE",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 60148,
      "protocol": "udp",
      "priority": 2113939711,
      "foundation": "1423450371"
     },
     {
      "id": "IUal3wm1R",
      "type": "local-candidate",
      "candidateType": "host",
      "address": "",
      "port": 61133,
      "protocol": "udp",
      "priority": 2113937151,
      "foundation": "3699918210"
     }
    ],
    "pairs": [
     {
      "id": "CPUal3wm1R_0IiteNlu",
      "type": "candidate-pair",
      "state": "succeeded",
      "nominated": true,
      "priority": 9079290933572287000,
      "localCandidateId": "IUal3wm1R",
      "remoteCandidateId": "I0IiteNlu",
      "requestsSent": 4,
      "responsesReceived": 4
     }
    ],
    "transport": {
     "id": "T01",
     "type": "transport",
     "dtlsState": "failed",
     "dtlsRole": "client",
     "iceRole": "controlled",
     "iceState": "connected",
     "selectedCandidatePairId": "CPUal3wm1R_0IiteNlu"
    }
   },
   "signal": [
    {
     "from": "caller",
     "kind": "offer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 7264421919793765952 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:uV9m\r\na=ice-pwd:iJ8DQQxYhkaIvzk8Nz34V+wP\r\na=ice-options:trickle\r\na=fingerprint:sha-256 00:E2:E7:D8:79:70:A6:AF:E6:9F:8A:E3:28:ED:54:49:42:6D:C4:97:05:F5:62:A2:ED:ED:8C:2E:E7:2C:37:4A\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "caller",
     "kind": "candidate",
     "bytes": 222,
     "candidate": "candidate:698509131 1 udp 2113937151 eae8be60-2a39-4b37-b414-504d85ac5239.local 49594 typ host generation 0 ufrag uV9m network-cost 999"
    },
    {
     "from": "callee",
     "kind": "answer",
     "bytes": 533,
     "sdp": "v=0\r\no=- 4944256832262571244 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:dPQP\r\na=ice-pwd:aYxrNUcT7BU3k7A4025Ptr5S\r\na=ice-options:trickle\r\na=fingerprint:sha-256 45:87:A8:68:D3:E3:09:C8:14:51:B6:19:9D:EC:4A:F6:E3:36:FF:BA:42:37:99:FC:CD:74:4C:A7:53:5E:36:36\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"
    },
    {
     "from": "callee",
     "kind": "candidate",
     "bytes": 223,
     "candidate": "candidate:3699918210 1 udp 2113937151 b5260fcd-76dc-4614-b03e-f9a087e613eb.local 61133 typ host generation 0 ufrag dPQP network-cost 999"
    }
   ],
   "turn": [],
   "relayStats": []
  }
 },
 "noMdnsCandidates": [
  "candidate:3255082168 1 udp 2113937151 192.168.1.105 58333 typ host generation 0 ufrag +fom network-cost 999",
  "candidate:1768869333 1 udp 1677729535 192.168.1.105 59333 typ srflx raddr 192.168.1.105 rport 58333 generation 0 ufrag +fom network-cost 999"
 ],
 "media": {
  "offer": "v=0\r\no=- 3380160933604312648 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1 2\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS 2091e6f5-2660-4dc5-b81d-628a069e9fae\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:0mjG\r\na=ice-pwd:cm0bGQv548oiJTjesVkg+b3R\r\na=ice-options:trickle\r\na=fingerprint:sha-256 58:A8:5D:EF:61:13:FD:17:6C:EB:52:29:01:21:5B:30:0B:F9:93:E0:86:C7:D0:CA:C6:EE:49:7A:65:EE:AF:3F\r\na=setup:actpass\r\na=mid:0\r\na=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=sendrecv\r\na=msid:2091e6f5-2660-4dc5-b81d-628a069e9fae c06c63cf-b274-433e-bedc-d4849285d9c0\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtcp-xr:rcvr-rtt=all\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\na=fmtp:63 111/111\r\na=rtpmap:9 G722/8000\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:13 CN/8000\r\na=rtpmap:110 telephone-event/48000\r\na=rtpmap:126 telephone-event/8000\r\na=ssrc:1172093722 cname:Q5p/cwdNJll+fpI0\r\na=ssrc:1172093722 msid:2091e6f5-2660-4dc5-b81d-628a069e9fae c06c63cf-b274-433e-bedc-d4849285d9c0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 104 107 108 109 114 115 116 117 39 40 45 46 98 99 100 101 118 119 120\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:0mjG\r\na=ice-pwd:cm0bGQv548oiJTjesVkg+b3R\r\na=ice-options:trickle\r\na=fingerprint:sha-256 58:A8:5D:EF:61:13:FD:17:6C:EB:52:29:01:21:5B:30:0B:F9:93:E0:86:C7:D0:CA:C6:EE:49:7A:65:EE:AF:3F\r\na=setup:actpass\r\na=mid:1\r\na=extmap:14 urn:ietf:params:rtp-hdrext:toffset\r\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\na=extmap:13 urn:3gpp:video-orientation\r\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay\r\na=extmap:6 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type\r\na=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing\r\na=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space\r\na=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id\r\na=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id\r\na=sendrecv\r\na=msid:2091e6f5-2660-4dc5-b81d-628a069e9fae 28d6fedb-4cbe-4ad1-8e95-64d09f2a32fb\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtcp-xr:rcvr-rtt=all\r\na=rtpmap:96 VP8/90000\r\na=rtcp-fb:96 goog-remb\r\na=rtcp-fb:96 transport-cc\r\na=rtcp-fb:96 ccm fir\r\na=rtcp-fb:96 nack\r\na=rtcp-fb:96 nack pli\r\na=rtpmap:97 rtx/90000\r\na=fmtp:97 apt=96\r\na=rtpmap:102 H264/90000\r\na=rtcp-fb:102 goog-remb\r\na=rtcp-fb:102 transport-cc\r\na=rtcp-fb:102 ccm fir\r\na=rtcp-fb:102 nack\r\na=rtcp-fb:102 nack pli\r\na=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f\r\na=rtpmap:103 rtx/90000\r\na=fmtp:103 apt=102\r\na=rtpmap:104 H264/90000\r\na=rtcp-fb:104 goog-remb\r\na=rtcp-fb:104 transport-cc\r\na=rtcp-fb:104 ccm fir\r\na=rtcp-fb:104 nack\r\na=rtcp-fb:104 nack pli\r\na=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f\r\na=rtpmap:107 rtx/90000\r\na=fmtp:107 apt=104\r\na=rtpmap:108 H264/90000\r\na=rtcp-fb:108 goog-remb\r\na=rtcp-fb:108 transport-cc\r\na=rtcp-fb:108 ccm fir\r\na=rtcp-fb:108 nack\r\na=rtcp-fb:108 nack pli\r\na=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\na=rtpmap:109 rtx/90000\r\na=fmtp:109 apt=108\r\na=rtpmap:114 H264/90000\r\na=rtcp-fb:114 goog-remb\r\na=rtcp-fb:114 transport-cc\r\na=rtcp-fb:114 ccm fir\r\na=rtcp-fb:114 nack\r\na=rtcp-fb:114 nack pli\r\na=fmtp:114 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f\r\na=rtpmap:115 rtx/90000\r\na=fmtp:115 apt=114\r\na=rtpmap:116 H264/90000\r\na=rtcp-fb:116 goog-remb\r\na=rtcp-fb:116 transport-cc\r\na=rtcp-fb:116 ccm fir\r\na=rtcp-fb:116 nack\r\na=rtcp-fb:116 nack pli\r\na=fmtp:116 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f\r\na=rtpmap:117 rtx/90000\r\na=fmtp:117 apt=116\r\na=rtpmap:39 H264/90000\r\na=rtcp-fb:39 goog-remb\r\na=rtcp-fb:39 transport-cc\r\na=rtcp-fb:39 ccm fir\r\na=rtcp-fb:39 nack\r\na=rtcp-fb:39 nack pli\r\na=fmtp:39 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f\r\na=rtpmap:40 rtx/90000\r\na=fmtp:40 apt=39\r\na=rtpmap:45 AV1/90000\r\na=rtcp-fb:45 goog-remb\r\na=rtcp-fb:45 transport-cc\r\na=rtcp-fb:45 ccm fir\r\na=rtcp-fb:45 nack\r\na=rtcp-fb:45 nack pli\r\na=fmtp:45 level-idx=5;profile=0;tier=0\r\na=rtpmap:46 rtx/90000\r\na=fmtp:46 apt=45\r\na=rtpmap:98 VP9/90000\r\na=rtcp-fb:98 goog-remb\r\na=rtcp-fb:98 transport-cc\r\na=rtcp-fb:98 ccm fir\r\na=rtcp-fb:98 nack\r\na=rtcp-fb:98 nack pli\r\na=fmtp:98 profile-id=0\r\na=rtpmap:99 rtx/90000\r\na=fmtp:99 apt=98\r\na=rtpmap:100 VP9/90000\r\na=rtcp-fb:100 goog-remb\r\na=rtcp-fb:100 transport-cc\r\na=rtcp-fb:100 ccm fir\r\na=rtcp-fb:100 nack\r\na=rtcp-fb:100 nack pli\r\na=fmtp:100 profile-id=2\r\na=rtpmap:101 rtx/90000\r\na=fmtp:101 apt=100\r\na=rtpmap:118 red/90000\r\na=rtpmap:119 rtx/90000\r\na=fmtp:119 apt=118\r\na=rtpmap:120 ulpfec/90000\r\na=ssrc-group:FID 1912089521 1535061193\r\na=ssrc:1912089521 cname:Q5p/cwdNJll+fpI0\r\na=ssrc:1912089521 msid:2091e6f5-2660-4dc5-b81d-628a069e9fae 28d6fedb-4cbe-4ad1-8e95-64d09f2a32fb\r\na=ssrc:1535061193 cname:Q5p/cwdNJll+fpI0\r\na=ssrc:1535061193 msid:2091e6f5-2660-4dc5-b81d-628a069e9fae 28d6fedb-4cbe-4ad1-8e95-64d09f2a32fb\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:0mjG\r\na=ice-pwd:cm0bGQv548oiJTjesVkg+b3R\r\na=ice-options:trickle\r\na=fingerprint:sha-256 58:A8:5D:EF:61:13:FD:17:6C:EB:52:29:01:21:5B:30:0B:F9:93:E0:86:C7:D0:CA:C6:EE:49:7A:65:EE:AF:3F\r\na=setup:actpass\r\na=mid:2\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n",
  "answer": "v=0\r\no=- 7427985662461610979 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1 2\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:Ruak\r\na=ice-pwd:MhUeUHyjR3rWg3LKlBukjlDs\r\na=ice-options:trickle\r\na=fingerprint:sha-256 DC:D4:03:DA:B0:5D:4A:27:F0:95:A7:C3:09:3C:87:88:56:33:CA:27:1E:55:6F:53:30:69:B6:4B:DC:79:3C:32\r\na=setup:active\r\na=mid:0\r\na=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=recvonly\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtcp-xr:rcvr-rtt=all\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\na=fmtp:63 111/111\r\na=rtpmap:9 G722/8000\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:13 CN/8000\r\na=rtpmap:110 telephone-event/48000\r\na=rtpmap:126 telephone-event/8000\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 104 107 108 109 114 115 116 117 39 40 45 46 98 99 100 101 118 119 120\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:Ruak\r\na=ice-pwd:MhUeUHyjR3rWg3LKlBukjlDs\r\na=ice-options:trickle\r\na=fingerprint:sha-256 DC:D4:03:DA:B0:5D:4A:27:F0:95:A7:C3:09:3C:87:88:56:33:CA:27:1E:55:6F:53:30:69:B6:4B:DC:79:3C:32\r\na=setup:active\r\na=mid:1\r\na=extmap:14 urn:ietf:params:rtp-hdrext:toffset\r\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\na=extmap:13 urn:3gpp:video-orientation\r\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay\r\na=extmap:6 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type\r\na=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing\r\na=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space\r\na=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id\r\na=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id\r\na=recvonly\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtcp-xr:rcvr-rtt=all\r\na=rtpmap:96 VP8/90000\r\na=rtcp-fb:96 goog-remb\r\na=rtcp-fb:96 transport-cc\r\na=rtcp-fb:96 ccm fir\r\na=rtcp-fb:96 nack\r\na=rtcp-fb:96 nack pli\r\na=rtpmap:97 rtx/90000\r\na=fmtp:97 apt=96\r\na=rtpmap:102 H264/90000\r\na=rtcp-fb:102 goog-remb\r\na=rtcp-fb:102 transport-cc\r\na=rtcp-fb:102 ccm fir\r\na=rtcp-fb:102 nack\r\na=rtcp-fb:102 nack pli\r\na=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f\r\na=rtpmap:103 rtx/90000\r\na=fmtp:103 apt=102\r\na=rtpmap:104 H264/90000\r\na=rtcp-fb:104 goog-remb\r\na=rtcp-fb:104 transport-cc\r\na=rtcp-fb:104 ccm fir\r\na=rtcp-fb:104 nack\r\na=rtcp-fb:104 nack pli\r\na=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f\r\na=rtpmap:107 rtx/90000\r\na=fmtp:107 apt=104\r\na=rtpmap:108 H264/90000\r\na=rtcp-fb:108 goog-remb\r\na=rtcp-fb:108 transport-cc\r\na=rtcp-fb:108 ccm fir\r\na=rtcp-fb:108 nack\r\na=rtcp-fb:108 nack pli\r\na=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\na=rtpmap:109 rtx/90000\r\na=fmtp:109 apt=108\r\na=rtpmap:114 H264/90000\r\na=rtcp-fb:114 goog-remb\r\na=rtcp-fb:114 transport-cc\r\na=rtcp-fb:114 ccm fir\r\na=rtcp-fb:114 nack\r\na=rtcp-fb:114 nack pli\r\na=fmtp:114 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f\r\na=rtpmap:115 rtx/90000\r\na=fmtp:115 apt=114\r\na=rtpmap:116 H264/90000\r\na=rtcp-fb:116 goog-remb\r\na=rtcp-fb:116 transport-cc\r\na=rtcp-fb:116 ccm fir\r\na=rtcp-fb:116 nack\r\na=rtcp-fb:116 nack pli\r\na=fmtp:116 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f\r\na=rtpmap:117 rtx/90000\r\na=fmtp:117 apt=116\r\na=rtpmap:39 H264/90000\r\na=rtcp-fb:39 goog-remb\r\na=rtcp-fb:39 transport-cc\r\na=rtcp-fb:39 ccm fir\r\na=rtcp-fb:39 nack\r\na=rtcp-fb:39 nack pli\r\na=fmtp:39 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f\r\na=rtpmap:40 rtx/90000\r\na=fmtp:40 apt=39\r\na=rtpmap:45 AV1/90000\r\na=rtcp-fb:45 goog-remb\r\na=rtcp-fb:45 transport-cc\r\na=rtcp-fb:45 ccm fir\r\na=rtcp-fb:45 nack\r\na=rtcp-fb:45 nack pli\r\na=fmtp:45 level-idx=5;profile=0;tier=0\r\na=rtpmap:46 rtx/90000\r\na=fmtp:46 apt=45\r\na=rtpmap:98 VP9/90000\r\na=rtcp-fb:98 goog-remb\r\na=rtcp-fb:98 transport-cc\r\na=rtcp-fb:98 ccm fir\r\na=rtcp-fb:98 nack\r\na=rtcp-fb:98 nack pli\r\na=fmtp:98 profile-id=0\r\na=rtpmap:99 rtx/90000\r\na=fmtp:99 apt=98\r\na=rtpmap:100 VP9/90000\r\na=rtcp-fb:100 goog-remb\r\na=rtcp-fb:100 transport-cc\r\na=rtcp-fb:100 ccm fir\r\na=rtcp-fb:100 nack\r\na=rtcp-fb:100 nack pli\r\na=fmtp:100 profile-id=2\r\na=rtpmap:101 rtx/90000\r\na=fmtp:101 apt=100\r\na=rtpmap:118 red/90000\r\na=rtpmap:119 rtx/90000\r\na=fmtp:119 apt=118\r\na=rtpmap:120 ulpfec/90000\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:Ruak\r\na=ice-pwd:MhUeUHyjR3rWg3LKlBukjlDs\r\na=ice-options:trickle\r\na=fingerprint:sha-256 DC:D4:03:DA:B0:5D:4A:27:F0:95:A7:C3:09:3C:87:88:56:33:CA:27:1E:55:6F:53:30:69:B6:4B:DC:79:3C:32\r\na=setup:active\r\na=mid:2\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n",
  "events": [
   {
    "who": "pc1",
    "k": "createOffer",
    "v": "done"
   },
   {
    "who": "pc1",
    "k": "signalingState",
    "v": "have-local-offer"
   },
   {
    "who": "pc1",
    "k": "iceGatheringState",
    "v": "gathering"
   },
   {
    "who": "pc2",
    "k": "signalingState",
    "v": "have-remote-offer"
   },
   {
    "who": "pc1",
    "k": "icecandidate",
    "v": "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 54354 typ host generation 0 ufrag 0mjG network-cost 999"
   },
   {
    "who": "pc1",
    "k": "icecandidate",
    "v": "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 50233 typ host generation 0 ufrag 0mjG network-cost 999"
   },
   {
    "who": "pc1",
    "k": "icecandidate",
    "v": "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 58008 typ host generation 0 ufrag 0mjG network-cost 999"
   },
   {
    "who": "pc2",
    "k": "signalingState",
    "v": "stable"
   },
   {
    "who": "pc2",
    "k": "iceGatheringState",
    "v": "gathering"
   },
   {
    "who": "pc2",
    "k": "iceConnectionState",
    "v": "checking"
   },
   {
    "who": "pc1",
    "k": "signalingState",
    "v": "stable"
   },
   {
    "who": "pc2",
    "k": "icecandidate",
    "v": "candidate:3512100133 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 54738 typ host generation 0 ufrag Ruak network-cost 999"
   },
   {
    "who": "pc1",
    "k": "iceConnectionState",
    "v": "checking"
   },
   {
    "who": "pc2",
    "k": "connectionState",
    "v": "connecting"
   },
   {
    "who": "pc2",
    "k": "iceConnectionState",
    "v": "connected"
   },
   {
    "who": "pc1",
    "k": "iceConnectionState",
    "v": "connected"
   },
   {
    "who": "pc1",
    "k": "connectionState",
    "v": "connecting"
   },
   {
    "who": "pc1",
    "k": "iceGatheringState",
    "v": "complete"
   },
   {
    "who": "pc1",
    "k": "icecandidate",
    "v": null
   },
   {
    "who": "pc2",
    "k": "iceGatheringState",
    "v": "complete"
   },
   {
    "who": "pc2",
    "k": "icecandidate",
    "v": null
   },
   {
    "who": "pc2",
    "k": "connectionState",
    "v": "connected"
   },
   {
    "who": "pc1",
    "k": "connectionState",
    "v": "connected"
   },
   {
    "who": "pc1",
    "k": "chat.open",
    "v": "open"
   },
   {
    "who": "pc2",
    "k": "message:chat",
    "v": "ping"
   },
   {
    "who": "pc1",
    "k": "message:chat",
    "v": "pong: ping"
   },
   {
    "who": "pc2",
    "k": "message:pos",
    "v": "x=1"
   }
  ],
  "channels": [
   {
    "label": "chat",
    "ordered": true,
    "maxRetransmits": null,
    "maxPacketLifeTime": null,
    "id": 1,
    "protocol": "",
    "negotiated": false
   },
   {
    "label": "pos",
    "ordered": false,
    "maxRetransmits": 0,
    "maxPacketLifeTime": null,
    "id": 3,
    "protocol": "",
    "negotiated": false
   }
  ],
  "sctp": {
   "maxMessageSize": 262144,
   "maxChannels": 65535,
   "state": "connected",
   "dtls": "connected",
   "ice": "connected"
  },
  "transport": [
   {
    "id": "T01",
    "type": "transport",
    "dtlsState": "connected",
    "dtlsRole": "server",
    "iceRole": "controlling",
    "iceState": "connected",
    "tlsVersion": "FEFC",
    "dtlsCipher": "TLS_AES_128_GCM_SHA256",
    "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
    "selectedCandidatePairId": "CPau8RkmJh_inVMF9jw"
   },
   {
    "id": "T01",
    "type": "transport",
    "dtlsState": "connected",
    "dtlsRole": "client",
    "iceRole": "controlled",
    "iceState": "connected",
    "tlsVersion": "FEFC",
    "dtlsCipher": "TLS_AES_128_GCM_SHA256",
    "srtpCipher": "SRTP_AES128_CM_HMAC_SHA1_80",
    "selectedCandidatePairId": "CPX17ryNMu_hhF6JIB4"
   }
  ],
  "certificates": [
   {
    "id": "CF58:A8:5D:EF:61:13:FD:17:6C:EB:52:29:01:21:5B:30:0B:F9:93:E0:86:C7:D0:CA:C6:EE:49:7A:65:EE:AF:3F",
    "fingerprint": "58:A8:5D:EF:61:13:FD:17:6C:EB:52:29:01:21:5B:30:0B:F9:93:E0:86:C7:D0:CA:C6:EE:49:7A:65:EE:AF:3F",
    "fingerprintAlgorithm": "sha-256",
    "base64Certificate": "MIIBFDCBvKADAgECAgg10Dw6i83XTTAKBggqhkjOPQQDAjARMQ8wDQYDVQQDDAZXZWJSVEMwHhcNMjYwOTMwMTEyNTA2WhcNMjYxMDMxMTEyNTA2WjARMQ8wDQYDVQQDDAZXZWJSVEMwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASeMce17xiwYYvaLIHTJmnis+hP85rJT8VjXhXHSdo8cAOZYgVgIdPFZmrvhO6axYmp39KFwyoov6HVD0LGuz62MAoGCCqGSM49BAMCA0cAMEQCID9TbUrKJTlZV87829HZoLuPcso13VxyUQKpmq6IFmLOAiA626pA0n9HczMtze6o/Njj5S9Oyk7JltrUjuxucbP4Dg=="
   },
   {
    "id": "CFDC:D4:03:DA:B0:5D:4A:27:F0:95:A7:C3:09:3C:87:88:56:33:CA:27:1E:55:6F:53:30:69:B6:4B:DC:79:3C:32",
    "fingerprint": "DC:D4:03:DA:B0:5D:4A:27:F0:95:A7:C3:09:3C:87:88:56:33:CA:27:1E:55:6F:53:30:69:B6:4B:DC:79:3C:32",
    "fingerprintAlgorithm": "sha-256",
    "base64Certificate": "MIIBFjCBvaADAgECAgkAzRiRuf77fmkwCgYIKoZIzj0EAwIwETEPMA0GA1UEAwwGV2ViUlRDMB4XDTI2MDkzMDExMjUwNloXDTI2MTAzMTExMjUwNlowETEPMA0GA1UEAwwGV2ViUlRDMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErIL3dxaqu6zkKFkkPA4XOMUsufi4QMnQgFAH2ZkwMHhnKY1E2c3OSwg/Su6onXaiU3rAgfiqdneAYvMcrQjhNzAKBggqhkjOPQQDAgNIADBFAiEA+OOrWeVru29uKuiPbqjLuk4eJP3+XVJ2czGBpTBmqhICIDziIKmwh7vnty321iaTKubB7kPBHbBi6SSKP18Agf2r"
   }
  ],
  "localCertificateId": "CF58:A8:5D:EF:61:13:FD:17:6C:EB:52:29:01:21:5B:30:0B:F9:93:E0:86:C7:D0:CA:C6:EE:49:7A:65:EE:AF:3F",
  "codecs": [
   {
    "mimeType": "audio/opus",
    "payloadType": 111,
    "clockRate": 48000,
    "channels": 2,
    "sdpFmtpLine": "minptime=10;useinbandfec=1"
   },
   {
    "mimeType": "video/VP8",
    "payloadType": 96,
    "clockRate": 90000
   }
  ],
  "outbound": [
   {
    "kind": "audio",
    "mid": "0",
    "codecId": "COT01_111_minptime=10;useinbandfec=1",
    "packetsSent": 75,
    "bytesSent": 5908
   },
   {
    "kind": "video",
    "mid": "1",
    "codecId": "COT01_96",
    "packetsSent": 38,
    "bytesSent": 2666,
    "frameWidth": 160,
    "frameHeight": 120
   }
  ],
  "dataChannels": [
   {
    "label": "chat",
    "dataChannelIdentifier": 1,
    "state": "open",
    "messagesSent": 1,
    "messagesReceived": 1,
    "bytesSent": 4,
    "bytesReceived": 10
   },
   {
    "label": "pos",
    "dataChannelIdentifier": 3,
    "state": "open",
    "messagesSent": 1,
    "messagesReceived": 0,
    "bytesSent": 3,
    "bytesReceived": 0
   }
  ],
  "candidates": [
   "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 54354 typ host generation 0 ufrag 0mjG network-cost 999",
   "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 50233 typ host generation 0 ufrag 0mjG network-cost 999",
   "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 58008 typ host generation 0 ufrag 0mjG network-cost 999"
  ]
 },
 "chromiumParse": {
  "candidate:3416709932 1 udp 2113937151 fefbb9f2-f057-4136-8b4b-55226f6d7990.local 52020 typ host generation 0 ufrag TCgj network-cost 999": {
   "foundation": "3416709932",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "fefbb9f2-f057-4136-8b4b-55226f6d7990.local",
   "port": 52020,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:51789610 1 udp 2113937151 5b7caf6a-3559-4ba0-b284-0950b9b67cf4.local 54786 typ host generation 0 ufrag Azty network-cost 999": {
   "foundation": "51789610",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "5b7caf6a-3559-4ba0-b284-0950b9b67cf4.local",
   "port": 54786,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:3653941407 1 udp 2113937151 25fa57d7-787d-4180-a013-858c00830d96.local 49180 typ host generation 0 ufrag dgL+ network-cost 999": {
   "foundation": "3653941407",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "25fa57d7-787d-4180-a013-858c00830d96.local",
   "port": 49180,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:1923148274 1 udp 1677729535 192.168.1.105 50180 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag dgL+ network-cost 999": {
   "foundation": "1923148274",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 50180,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:4133211840 1 udp 2113937151 2aea4496-df77-4405-90e8-ea316646e049.local 51696 typ host generation 0 ufrag +5oq network-cost 999": {
   "foundation": "4133211840",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "2aea4496-df77-4405-90e8-ea316646e049.local",
   "port": 51696,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:3978506643 1 udp 50339839 192.168.1.105 50920 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag LwHV network-cost 999": {
   "foundation": "3978506643",
   "component": "rtp",
   "protocol": "udp",
   "priority": 50339839,
   "address": "192.168.1.105",
   "port": 50920,
   "type": "relay",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:2239969783 1 udp 50339839 192.168.1.105 50921 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag wiBT network-cost 999": {
   "foundation": "2239969783",
   "component": "rtp",
   "protocol": "udp",
   "priority": 50339839,
   "address": "192.168.1.105",
   "port": 50921,
   "type": "relay",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:922590967 1 udp 2113937151 d907ce51-7e57-4415-b1f0-996cfe49dfd6.local 53428 typ host generation 0 ufrag ajVJ network-cost 999": {
   "foundation": "922590967",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "d907ce51-7e57-4415-b1f0-996cfe49dfd6.local",
   "port": 53428,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:2643971994 1 udp 1677729535 192.168.1.105 54428 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag ajVJ network-cost 999": {
   "foundation": "2643971994",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 54428,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:1738519825 1 udp 2113937151 66b4acfb-a33d-4f8c-9f69-a6a180ead82b.local 62401 typ host generation 0 ufrag CqnY network-cost 999": {
   "foundation": "1738519825",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "66b4acfb-a33d-4f8c-9f69-a6a180ead82b.local",
   "port": 62401,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:3438666876 1 udp 1677729535 192.168.1.105 63401 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag CqnY network-cost 999": {
   "foundation": "3438666876",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 63401,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:862604198 1 udp 50339839 192.168.1.105 50920 typ relay raddr 192.168.1.105 rport 54421 generation 0 ufrag ajVJ network-cost 999": {
   "foundation": "862604198",
   "component": "rtp",
   "protocol": "udp",
   "priority": 50339839,
   "address": "192.168.1.105",
   "port": 50920,
   "type": "relay",
   "relatedAddress": "192.168.1.105",
   "relatedPort": 54421,
   "usernameFragment": null
  },
  "candidate:1644716096 1 udp 50339839 192.168.1.105 50921 typ relay raddr 192.168.1.105 rport 63394 generation 0 ufrag CqnY network-cost 999": {
   "foundation": "1644716096",
   "component": "rtp",
   "protocol": "udp",
   "priority": 50339839,
   "address": "192.168.1.105",
   "port": 50921,
   "type": "relay",
   "relatedAddress": "192.168.1.105",
   "relatedPort": 63394,
   "usernameFragment": null
  },
  "candidate:922590967 1 udp 2113937151 d907ce51-7e57-4415-b1f0-996cfe49dfd6.local 53421 typ host generation 0 ufrag ajVJ network-cost 999": {
   "foundation": "922590967",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "d907ce51-7e57-4415-b1f0-996cfe49dfd6.local",
   "port": 53421,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:2643971994 1 udp 1677729535 192.168.1.105 54421 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag ajVJ network-cost 999": {
   "foundation": "2643971994",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 54421,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:1738519825 1 udp 2113937151 66b4acfb-a33d-4f8c-9f69-a6a180ead82b.local 62394 typ host generation 0 ufrag CqnY network-cost 999": {
   "foundation": "1738519825",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "66b4acfb-a33d-4f8c-9f69-a6a180ead82b.local",
   "port": 62394,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:3438666876 1 udp 1677729535 192.168.1.105 63394 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag CqnY network-cost 999": {
   "foundation": "3438666876",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 63394,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:973245910 1 udp 2113937151 49e06cd2-6e6d-4765-898f-ab84217eb137.local 62703 typ host generation 0 ufrag Q8ef network-cost 999": {
   "foundation": "973245910",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "49e06cd2-6e6d-4765-898f-ab84217eb137.local",
   "port": 62703,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:2439568571 1 udp 1677729535 192.168.1.105 63703 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag Q8ef network-cost 999": {
   "foundation": "2439568571",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 63703,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:956683322 1 udp 2113937151 c25aec41-157d-4191-8f2d-1437d6222108.local 59745 typ host generation 0 ufrag WBbR network-cost 999": {
   "foundation": "956683322",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "c25aec41-157d-4191-8f2d-1437d6222108.local",
   "port": 59745,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:2187976725 1 udp 1677729535 192.168.1.105 60745 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag WBbR network-cost 999": {
   "foundation": "2187976725",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 60745,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:973245910 1 udp 2113937151 49e06cd2-6e6d-4765-898f-ab84217eb137.local 62696 typ host generation 0 ufrag Q8ef network-cost 999": {
   "foundation": "973245910",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "49e06cd2-6e6d-4765-898f-ab84217eb137.local",
   "port": 62696,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:2439568571 1 udp 1677729535 192.168.1.105 63696 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag Q8ef network-cost 999": {
   "foundation": "2439568571",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 63696,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:956683322 1 udp 2113937151 c25aec41-157d-4191-8f2d-1437d6222108.local 59738 typ host generation 0 ufrag WBbR network-cost 999": {
   "foundation": "956683322",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "c25aec41-157d-4191-8f2d-1437d6222108.local",
   "port": 59738,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:2187976725 1 udp 1677729535 192.168.1.105 60738 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag WBbR network-cost 999": {
   "foundation": "2187976725",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 60738,
   "type": "srflx",
   "relatedAddress": "0.0.0.0",
   "relatedPort": 0,
   "usernameFragment": null
  },
  "candidate:698509131 1 udp 2113937151 eae8be60-2a39-4b37-b414-504d85ac5239.local 49594 typ host generation 0 ufrag uV9m network-cost 999": {
   "foundation": "698509131",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "eae8be60-2a39-4b37-b414-504d85ac5239.local",
   "port": 49594,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:3699918210 1 udp 2113937151 b5260fcd-76dc-4614-b03e-f9a087e613eb.local 61133 typ host generation 0 ufrag dPQP network-cost 999": {
   "foundation": "3699918210",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "b5260fcd-76dc-4614-b03e-f9a087e613eb.local",
   "port": 61133,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:3255082168 1 udp 2113937151 192.168.1.105 58333 typ host generation 0 ufrag +fom network-cost 999": {
   "foundation": "3255082168",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "192.168.1.105",
   "port": 58333,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:1768869333 1 udp 1677729535 192.168.1.105 59333 typ srflx raddr 192.168.1.105 rport 58333 generation 0 ufrag +fom network-cost 999": {
   "foundation": "1768869333",
   "component": "rtp",
   "protocol": "udp",
   "priority": 1677729535,
   "address": "192.168.1.105",
   "port": 59333,
   "type": "srflx",
   "relatedAddress": "192.168.1.105",
   "relatedPort": 58333,
   "usernameFragment": null
  },
  "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 54354 typ host generation 0 ufrag 0mjG network-cost 999": {
   "foundation": "615829968",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local",
   "port": 54354,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 50233 typ host generation 0 ufrag 0mjG network-cost 999": {
   "foundation": "615829968",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local",
   "port": 50233,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  },
  "candidate:615829968 1 udp 2113937151 01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local 58008 typ host generation 0 ufrag 0mjG network-cost 999": {
   "foundation": "615829968",
   "component": "rtp",
   "protocol": "udp",
   "priority": 2113937151,
   "address": "01ac5d38-9a8b-47b6-ace4-ccc1cc76a0a3.local",
   "port": 58008,
   "type": "host",
   "relatedAddress": null,
   "relatedPort": null,
   "usernameFragment": null
  }
 }
};
