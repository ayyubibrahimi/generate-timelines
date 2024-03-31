import { NextApiRequest, NextApiResponse } from 'next';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const upload = multer({ dest: 'public/uploads/' });

export const config = {
  api: {
    bodyParser: false,
  },
};

const scriptsDir = path.join(process.cwd(), 'pages/api');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        res.status(500).json({ error: 'File upload failed' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const tempFilePath = `public/uploads/${file.filename}.pdf`;
      fs.renameSync(file.path, tempFilePath);

      const tempOutputPath = `public/uploads/${file.filename}.json`;

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });

      // Process the PDF with ocr.py script
      const ocrScriptPath = path.join(scriptsDir, 'ocr.py');
      const ocrProcess = spawn('python3', [ocrScriptPath, tempFilePath, tempOutputPath]);

      ocrProcess.stderr.on('data', (data) => {
        console.error(`OCR script error: ${data}`);
      });

      ocrProcess.on('close', (code) => {
        if (code === 0) {
          // Pass the output file path of ocr.py to process.py script
          const processScriptPath = path.join(scriptsDir, 'process.py');
          const processProcess = spawn('python3', [processScriptPath, tempOutputPath]);

          let processOutput = '';

          processProcess.stdout.on('data', (data) => {
            processOutput += data.toString();
          });

          processProcess.stderr.on('data', (data) => {
            console.error(`Process script error: ${data}`);
          });

          processProcess.on('close', (code) => {
            if (code === 0) {
              try {
                console.log('Process output:', processOutput);
                const sentencePagePairs = JSON.parse(processOutput);
                console.log('Parsed sentence-page pairs:', sentencePagePairs);

                const pdfFilePath = `/uploads/${file.filename}.pdf`;
                res.write(JSON.stringify({ sentencePagePairs, filePath: pdfFilePath }));
              } catch (error) {
                console.error('Error parsing process output:', error);
                res.write(JSON.stringify({ error: 'Error parsing process output' }));
              }
            } else {
              console.error('Process script failed with code:', code);
              res.write(JSON.stringify({ error: 'Process script failed' }));
            }
            res.end();
          });
        } else {
          console.error('OCR script failed with code:', code);
          res.end(JSON.stringify({ error: 'OCR script failed' }));
        }
      });
    });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}