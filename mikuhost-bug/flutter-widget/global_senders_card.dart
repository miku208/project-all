import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

/// ============================================================
/// GlobalSendersCard — widget dashboard untuk status Sender Global
///
/// Mengambil data dari: GET {baseUrl}/globalSenders?key=<sessionKey>
/// Respons server:
/// {
///   "valid": true,
///   "authorized": true,       // false jika role bukan vip/owner/reseller/admin
///   "canUse": true,
///   "role": "vip",
///   "username": "mikuhost",
///   "senders": [{"number": "628•••••47", "online": true}],
///   "total": 1,
///   "onlineCount": 1
/// }
///
/// Cara pakai di dashboard APK:
///   GlobalSendersCard(
///     sessionKey: mySessionKey,               // key dari /validate
///     baseUrl: 'https://ashimusic.biz.id/apidv',
///   )
/// Auto-refresh tiap 15 detik + pull-to-refresh.
/// ============================================================

class GlobalSendersCard extends StatefulWidget {
  const GlobalSendersCard({
    super.key,
    required this.sessionKey,
    this.baseUrl = 'https://ashimusic.biz.id/apidv',
    this.refreshInterval = const Duration(seconds: 15),
    this.onTapRetryLogin,
  });

  /// Session key user yang didapat setelah /validate
  final String sessionKey;

  /// Base URL API, tanpa trailing slash
  final String baseUrl;

  /// Interval auto-refresh
  final Duration refreshInterval;

  /// Dipanggil saat key invalid (mis. redirect ke halaman login)
  final VoidCallback? onTapRetryLogin;

  @override
  State<GlobalSendersCard> createState() => _GlobalSendersCardState();
}

class _GlobalSendersCardState extends State<GlobalSendersCard> {
  bool _loading = true;
  String? _error;
  bool _authorized = false;
  bool _canUse = false;
  String _role = 'member';
  List<_GlobalSender> _senders = [];
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _fetch();
    _timer = Timer.periodic(widget.refreshInterval, (_) => _fetch());
  }

  @override
  void didUpdateWidget(covariant GlobalSendersCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.sessionKey != widget.sessionKey) _fetch();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _fetch() async {
    if (!mounted) return;
    setState(() => _loading = true);

    try {
      final uri = Uri.parse(
          '${widget.baseUrl}/globalSenders?key=${Uri.encodeComponent(widget.sessionKey)}');
      final httpClient = HttpClient()
        ..connectionTimeout = const Duration(seconds: 10);

      final req = await httpClient.getUrl(uri);
      final resp = await req.close();
      final body = await resp.transform(utf8.decoder).join();
      httpClient.close();

      final json = jsonDecode(body) as Map<String, dynamic>;

      if (json['valid'] != true) {
        // Key invalid / expired
        setState(() {
          _error = 'Sesi tidak valid. Silakan login ulang.';
          _senders = [];
          _loading = false;
        });
        return;
      }

      final list = (json['senders'] as List? ?? [])
          .map((e) => _GlobalSender(
                number: (e['number'] ?? '?').toString(),
                online: e['online'] == true,
              ))
          .toList();

      setState(() {
        _error = json['authorized'] == false
            ? (json['message']?.toString() ??
                'Sender global hanya untuk VIP/Owner/Reseller/Admin.')
            : null;
        _authorized = json['authorized'] == true;
        _canUse = json['canUse'] == true;
        _role = (json['role'] ?? 'member').toString();
        _senders = list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Gagal terhubung ke server.';
        _loading = false;
      });
    }
  }

  Future<void> _refresh() => _fetch();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onlineCount = _senders.where((s) => s.online).length;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // ===== Header =====
            Row(
              children: [
                const Text('🌐', style: TextStyle(fontSize: 20)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Sender Global',
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                if (_canUse)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: onlineCount > 0
                          ? Colors.green.withOpacity(.15)
                          : Colors.grey.withOpacity(.2),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '$onlineCount/${_senders.length} online',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: onlineCount > 0 ? Colors.green : Colors.grey,
                      ),
                    ),
                  ),
                IconButton(
                  icon: _loading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 20),
                  onPressed: _loading ? null : _refresh,
                  tooltip: 'Refresh',
                ),
              ],
            ),

            const SizedBox(height: 8),

            // ===== Konten =====
            if (_loading && _senders.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (!_canUse)
              // Member biasa → upsell
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.withOpacity(.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.amber.withOpacity(.4)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.lock_outline,
                        color: Colors.amber, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Sender global khusus VIP, Owner, Reseller & Admin.\nRole kamu: $_role — upgrade ke VIP untuk pakai fitur ini.',
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
              )
            else if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: Colors.red, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(_error!,
                          style: theme.textTheme.bodySmall
                              ?.copyWith(color: Colors.red)),
                    ),
                    TextButton(
                      onPressed: _error!.contains('login') &&
                              widget.onTapRetryLogin != null
                          ? widget.onTapRetryLogin
                          : _refresh,
                      child: Text(_error!.contains('login') ? 'Login' : 'Coba'),
                    ),
                  ],
                ),
              )
            else if (_senders.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'Belum ada sender global terpasang.',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontStyle: FontStyle.italic),
                ),
              )
            else
              // ===== Daftar sender (nomor ter-sensor dari server) =====
              ..._senders.map((s) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: s.online ? Colors.green : Colors.grey,
                            boxShadow: s.online
                                ? [
                                    BoxShadow(
                                      color: Colors.green.withOpacity(.5),
                                      blurRadius: 6,
                                      spreadRadius: 1,
                                    )
                                  ]
                                : null,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            s.number, // sudah di-sensor oleh server (628•••••xx)
                            style: theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                        Text(
                          s.online ? 'Terhubung' : 'Offline',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: s.online ? Colors.green : Colors.grey,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  )),

            if (_canUse && _senders.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Bug kamu dikirim otomatis lewat sender global yang online.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurface.withOpacity(.5),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _GlobalSender {
  final String number;
  final bool online;
  _GlobalSender({required this.number, required this.online});
}
