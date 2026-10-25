// Media lives in out/assets (git-ignored): Blender frames, narration, music and the screen recordings.
import { Config } from '@remotion/cli/config';

Config.setPublicDir('out/assets');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCrf(16);
Config.setOverwriteOutput(true);
