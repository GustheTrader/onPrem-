import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime

# Load env
env_path = Path("c:/Users/trade/OnPrem/terminal/backend/.env")
load_dotenv(env_path)

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")

with open("c:/Users/trade/OnPrem/terminal/backend/check_output.txt", "w") as f:
    try:
        from supabase import create_client
        supabase = create_client(url, key)
        
        # Check latest bars
        try:
            res = supabase.table("bars").select("ts").order("ts", desc=True).limit(1).execute()
            if res.data:
                latest_ts = res.data[0]['ts']
                dt = datetime.fromtimestamp(latest_ts/1000)
                f.write(f"Latest Bar TS: {latest_ts} ({dt})\n")
            else:
                f.write("No bars found.\n")
        except Exception as e:
            f.write(f"Bars latest check failed: {e}\n")
            
        # Check latest prob_snapshots
        try:
            res = supabase.table("prob_snapshots").select("ts").order("ts", desc=True).limit(1).execute()
            if res.data:
                latest_ts = res.data[0]['ts']
                dt = datetime.fromtimestamp(latest_ts/1000)
                f.write(f"Latest Prob Snapshot TS: {latest_ts} ({dt})\n")
            else:
                f.write("No prob snapshots found.\n")
        except Exception as e:
            f.write(f"Prob_snapshots latest check failed: {e}\n")

    except ImportError:
        f.write("Error: 'supabase' package is not installed.\n")
    except Exception as e:
        f.write(f"An error occurred: {e}\n")
