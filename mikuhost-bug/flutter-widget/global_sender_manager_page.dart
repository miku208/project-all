import 'package:flutter/material.dart';

import 'sender_mode_picker.dart'; // untuk GlobalSenderApi

/// ============================================================
/// GlobalSenderManagerPage — halaman kelola sender global (owner/admin)
///
/// Buka dari dashboard (hanya tampilkan tombolnya jika canManageGlobal == true
/// dari /mySender, atau role owner/admin):
///   Navigator.push(context, MaterialPageRoute(
///     builder: (_) => GlobalSenderManagerPage(
///       sessionKey: mySessionKey,
///       baseUrl: 'https://ashimusic.biz.id/apidv',
///     ),
///   ));
/// ============================================================

class GlobalSenderManagerPage extends StatefulWidget {
  const GlobalSenderManagerPage({
    super.key,
    required this.sessionKey,
    this.baseUrl = 'https://ashimusic.biz.id/apidv',
  });

  final String sessionKey;
  final String baseUrl;

  @override
  State<GlobalSenderManagerPage> createState() =>
      _GlobalSenderManagerPageState();
}

class _GlobalSenderManagerPageState extends State<GlobalSenderManagerPage> {
  bool _loading = true;
  List<Map<String, dynamic>> _senders = [];
  bool _canManage = false;
  final _credsController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  @override
  void dispose() {
    _credsController.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    setState(() => _loading = true);
    try {
      final data = await GlobalSenderApi.fetchStatus(widget.baseUrl, widget.sessionKey);
      if (!mounted) return;
      setState(() {
        _canManage = data['canManage'] == true;
        _senders = (data['senders'] as List? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _addSender() async {
    final credsJson = _credsController.text.trim();
    if (credsJson.isEmpty) {
      _toast('Paste isi creds.json dulu');
      return;
    }

    _toast('Menambahkan sender...');
    try {
      final res = await GlobalSenderApi.addSender(
          widget.baseUrl, widget.sessionKey, credsJson);
      _toast(res['message']?.toString() ?? 'Selesai');
      if (res['added'] == true) {
        _credsController.clear();
        Navigator.of(context).pop(); // tutup sheet
        await _fetch();
      }
    } catch (e) {
      _toast('Gagal: JSON tidak valid atau server error');
    }
  }

  Future<void> _deleteSender(String number) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Hapus sender global?'),
        content: Text('$number akan diputus & dihapus permanen.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Hapus')),
        ],
      ),
    );
    if (ok != true) return;

    try {
      final res = await GlobalSenderApi.deleteSender(widget.baseUrl, widget.sessionKey, number);
      _toast(res['message']?.toString() ?? 'Selesai');
      await _fetch();
    } catch (_) {
      _toast('Gagal menghapus sender');
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  void _showAddSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          left: 16, right: 16, top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Tambah Sender Global',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text(
              'Login WhatsApp di terminal/panel lain, ambil file creds.json-nya, '
              'lalu paste seluruh isi file di bawah ini.',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _credsController,
              maxLines: 8,
              decoration: const InputDecoration(
                hintText: '{ "noiseKey": "...", "me": {...}, ... }',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _addSender,
                icon: const Icon(Icons.add),
                label: const Text('Tambahkan & Sambungkan'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final onlineCount = _senders.where((s) => s['online'] == true).length;

    return Scaffold(
      appBar: AppBar(title: const Text('🌐 Kelola Sender Global')),
      floatingActionButton: _canManage
          ? FloatingActionButton.extended(
              onPressed: _showAddSheet,
              icon: const Icon(Icons.add),
              label: const Text('Tambah'),
            )
          : null,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _fetch,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.purple.withOpacity(.1),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        const Text('🌐', style: TextStyle(fontSize: 22)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            '$_onlineCount/${_senders.length} sender online\nSender global dipakai semua role kecuali member',
                            style: const TextStyle(height: 1.4),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (!_canManage)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(14),
                        child: Text('🔒 Hanya owner/admin yang bisa menambah atau menghapus sender global.'),
                      ),
                    )
                  else if (_senders.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: Center(child: Text('Belum ada sender global.\nTekan tombol Tambah untuk memasang.', textAlign: TextAlign.center)),
                    )
                  else
                    ..._senders.map((s) => Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          child: ListTile(
                            leading: Container(
                              width: 12, height: 12,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: s['online'] == true ? Colors.green : Colors.grey,
                              ),
                            ),
                            title: Text('${s['number']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                            subtitle: Text(s['online'] == true ? 'Terhubung' : 'Offline'),
                            trailing: _canManage
                                ? IconButton(
                                    icon: const Icon(Icons.delete_outline, color: Colors.red),
                                    onPressed: () => _deleteSender('${s['number']}'),
                                  )
                                : null,
                          ),
                        )),
                ],
              ),
            ),
    );
  }
}
