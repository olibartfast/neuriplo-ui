import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
launcher_spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch.py'))
launcher = importlib.util.module_from_spec(launcher_spec)
launcher_spec.loader.exec_module(launcher)


class InstallerTests(unittest.TestCase):
    def test_dry_run_has_no_network_or_system_changes(self):
        for style in ['native', 'docker']:
            with patch('sys.argv', ['install.py', '--style', style, '--dry-run']), \
                    patch.object(installer, 'fetch_json') as fetch, \
                    patch.object(installer, 'command') as command, \
                    patch('sys.stdout', new_callable=io.StringIO) as output:
                installer.main()
                self.assertEqual(json.loads(output.getvalue())['style'], style)
                fetch.assert_not_called()
                command.assert_not_called()

    def test_libtorch_rejects_archive_with_wrong_build(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory)
            def unpack(*args):
                sdk = prefix / 'sdk/libtorch'
                sdk.mkdir()
                (sdk / 'build-version').write_text('2.0.1+cu118')
            with patch.object(installer, 'download', return_value=prefix / 'archive.zip'), \
                    patch.object(installer, 'extract', side_effect=unpack):
                with self.assertRaisesRegex(ValueError, 'Installed LibTorch'):
                    installer.install_sdk('libtorch', prefix, prefix / 'sources',
                                          {'PYTORCH_VERSION': '2.14.0'}, {}, 2)

    def test_archive_cannot_write_outside_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'bad.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                item = tarfile.TarInfo('../escaped')
                item.size = 4
                output.addfile(item, io.BytesIO(b'data'))
            with self.assertRaises(tarfile.FilterError):
                installer.extract(archive, root / 'sdk')
            self.assertFalse((root / 'escaped').exists())

    def test_checksum_mismatch_never_publishes_download(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'archive.tgz'
            with patch.object(installer.urllib.request, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(b'wrong')), \
                    patch.object(installer.time, 'sleep'):
                with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                    installer.download('https://example.invalid/sdk', target, '0' * 64)
            self.assertFalse(target.exists())
            self.assertFalse(target.with_name('archive.tgz.partial').exists())

    def test_context_never_contains_git_or_private_promo_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root / 'source'; target = root / 'context'
            source.mkdir();target.mkdir();(source / '.git').mkdir();(source / 'specs').mkdir()
            (source / 'README.md').write_text('public')
            (source / 'specs/internal-promo.md').write_text('private')
            with patch.object(installer, 'command', return_value='README.md\0specs/internal-promo.md\0'):
                copied = installer.copy_overlay(source, target)
            self.assertEqual(copied, ['README.md'])
            self.assertFalse((target / '.git').exists())
            self.assertFalse((target / 'specs/internal-promo.md').exists())

    def test_context_rejects_a_symlinked_source_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            (source / '.git').mkdir()
            outside = root / 'outside'
            outside.mkdir()
            (outside / 'secret.txt').write_text('private')
            (source / 'docs').symlink_to(outside, target_is_directory=True)
            with patch.object(installer, 'command', return_value='docs/secret.txt\0'):
                with self.assertRaisesRegex(ValueError, 'Symlinked'):
                    installer.copy_overlay(source, root / 'context')
            self.assertFalse((root / 'context').exists())

    def test_nonempty_unowned_install_prefix_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory); (prefix / 'keep.txt').write_text('keep')
            args = argparse.Namespace(prefix=prefix, backend='onnx_runtime')
            with patch.object(installer, 'apt') as apt:
                with self.assertRaisesRegex(ValueError, 'not empty'):
                    installer.native(args)
                apt.assert_not_called()
            self.assertEqual((prefix / 'keep.txt').read_text(), 'keep')

    def test_changed_installed_binary_is_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory);binary = prefix / 'infer';binary.write_text('changed')
            (prefix / 'installation.json').write_text(json.dumps({'backend':'onnx_runtime','binary':str(binary),'binary_sha256':'old'}))
            with self.assertRaisesRegex(ValueError, 'runtime changed'):
                installer.native(argparse.Namespace(prefix=prefix,backend='onnx_runtime'))

    def test_gpu_setup_does_not_restart_running_containers_implicitly(self):
        args = argparse.Namespace(allow_docker_restart=False)
        with patch.object(installer, 'ensure_nvidia_driver'), \
                patch.object(installer, 'command', side_effect=['{}','running-container']), \
                patch.object(installer, 'apt') as apt:
            with self.assertRaisesRegex(ValueError, '--allow-docker-restart'):
                installer.ensure_container_gpu(args, ['docker'])
            apt.assert_not_called()

    def test_sudo_build_preserves_optional_secret_without_argument_value(self):
        with patch.dict(os.environ, {'GH_TOKEN': 'example-secret'}):
            command = installer.docker_build_engine(['sudo', 'docker'])
            self.assertEqual(command, ['sudo', '--preserve-env=GH_TOKEN', 'docker'])
            self.assertNotIn('example-secret', ' '.join(command))
            self.assertEqual(installer.docker_build_engine(['docker']), ['docker'])
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(installer.docker_build_engine(['sudo', 'docker']), ['sudo', 'docker'])

    def test_executorch_xnnpack_avoids_unrelated_delegate_submodules(self):
        entries = '\n'.join('submodule.' + p + '.path ' + p for p in [
            'backends/xnnpack/third-party/XNNPACK', 'third-party/flatbuffers',
            'third-party/prelude', 'shim', 'kernels/optimized/third-party/eigen',
            'backends/arm/third-party/ethos-u-core-driver',
            'backends/vulkan/third-party/Vulkan-Headers', 'extension/llm/tokenizers'])
        with patch.object(installer, 'command', return_value=entries):
            selected = installer.executorch_submodules(Path('/source'))
        self.assertEqual(selected, ['backends/xnnpack/third-party/XNNPACK',
                                  'third-party/flatbuffers', 'third-party/prelude', 'shim'])

    def test_tensor_rt_11_archive_uses_cuda_build_line(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            versions = {'CUDA_VERSION':'13.4.1','TENSORRT_VERSION':'11.2.1.2','TENSORRT_CUDA_VERSION':'13.3'}
            with patch.dict(os.environ, {'NEURIPLO_CONTAINER_BUILD':'1'}), \
                    patch.object(installer,'download',return_value=root/'archive') as download, \
                    patch.object(installer,'extract'),patch.object(installer,'command'),patch.object(installer,'apt'):
                flags = installer.install_sdk('tensorrt',root,{},versions,{},4)
            url = download.call_args_list[-1].args[0]
            self.assertIn('cuda-13.3-Release-external.tar.zst',url)
            self.assertTrue(any('cuda-13.4' in f for f in flags))

    def test_openvino_wheel_layout_keeps_both_cmake_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module = root / 'venv/lib/python3.12/site-packages/openvino'
            (module / 'libs').mkdir(parents=True)
            (module / 'libs/libopenvino.so').write_text('runtime')
            with patch.object(installer, 'command', side_effect=[None, None, str(module)]):
                installer.install_sdk('openvino', root, {}, {'OPENVINO_VERSION':'2026.3.0'}, {}, 2)
            self.assertTrue((root/'sdk/openvino/runtime/libs/libopenvino.so').exists())
            self.assertTrue((root/'sdk/openvino/openvino/libs/libopenvino.so').exists())

    def test_launcher_uses_one_web_api_process_and_the_workspace(self):
        state={'node':'/private/node/bin','app':'/private/app','binary':'/private/infer',
               'environment':{'LD_LIBRARY_PATH':'/private/sdk/lib'}}
        environment=launcher.runtime_environment(state,'127.0.0.1',5173,Path('/workspace'))
        self.assertEqual(environment['NEURIPLO_UI_WEB_ROOT'],'/private/app/apps/web/dist')
        self.assertEqual(environment['NEURIPLO_UI_BROWSE_ROOT'],'/workspace')
        self.assertEqual(environment['HOST'],'127.0.0.1')
        self.assertTrue(environment['PATH'].startswith('/private/node/bin:'))


if __name__ == '__main__':
    unittest.main()
