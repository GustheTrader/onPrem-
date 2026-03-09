"""
terminal/backend/check_supabase.py — Utility to verify Supabase data.
Retrieves latest row from bars and prob_snapshots tables.
"""

import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_KEY")

def main():
    if not URL or not KEY:
        print("Error: SUPABASE_URL or SUPABASE_KEY missing in .env")
        return

    supabase: Client = create_client(URL, KEY)
    print(f"Connected to: {URL}")

    # Check bars
    try:
        res = supabase.table("bars").select("ts").order("ts", desc=True).limit(1).execute()
        if res.data:
            print(f"Latest bar timestamp: {res.data[0]['ts']}")
        else:
            print("No data in 'bars' table.")
    except Exception as e:
        print(f"Error reading bars: {e}")

    # Check prob_snapshots
    try:
        res = supabase.table("prob_snapshots").select("ts").order("ts", desc=True).limit(1).execute()
        if res.data:
            print(f"Latest probability snapshot: {res.data[0]['ts']}")
        else:
            print("No data in 'prob_snapshots' table.")
    except Exception as e:
        print(f"Error reading snapshots: {e}")

if __name__ == "__main__":
    main()
